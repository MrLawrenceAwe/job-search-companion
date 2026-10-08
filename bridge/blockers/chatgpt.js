import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, customFetch } from "jose";
import { openPrivateStore } from "./private-store.js";

const AUTH = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const random = () => randomBytes(32).toString("base64url");
const terminalRefreshErrors = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);

export class ChatGPTError extends Error {
  constructor(message, code = "connection_error", status = 503) {
    super(message); this.code = code; this.status = status;
  }
}

export const openChatGPT = async ({ path, fetchImpl = fetch, verifyIdentity }) => {
  const store = await openPrivateStore(path, { hostId: `urn:uuid:${randomUUID()}`, activeId: null, profiles: [] });
  await store.save();
  const data = store.value;
  const jwks = createRemoteJWKSet(new URL(`${AUTH}/.well-known/jwks.json`), { [customFetch]: fetchImpl });
  const verify = verifyIdentity || (async (token, clientId, nonce) => {
    const { payload } = await jwtVerify(token, jwks, { issuer: AUTH, audience: clientId, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "nonce"] });
    if (payload.nonce !== nonce || !payload.sub) throw new Error("ChatGPT identity validation failed");
    return payload;
  });
  let login = null;
  let refresh = null;
  let lastError = null;
  const active = () => data.profiles.find((p) => p.id === data.activeId);
  const session = () => {
    const p = active();
    return {
      connected: Boolean(p?.accessToken), sharing: Boolean(p?.accessToken && p.scopes.includes("chatgpt.tokens.use.direct")),
      activeId: data.activeId,
      profiles: data.profiles.map(({ id, email, clientId }) => ({ id, email, label: `${email || "ChatGPT account"} · ${clientId.slice(-8)}` })),
      pending: Boolean(login), error: lastError,
    };
  };
  const tokenRequest = async (params) => {
    const response = await fetchImpl(`${AUTH}/api/accounts/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json();
    if (!response.ok) throw new ChatGPTError("ChatGPT authentication failed. Try reconnecting in settings.", body.error || "auth_error", response.status);
    if (!body.access_token || body.token_type?.toLowerCase() !== "bearer") throw new ChatGPTError("ChatGPT returned an invalid token response");
    return body;
  };
  const credentials = (body, old = {}) => ({
    accessToken: body.access_token, refreshToken: body.refresh_token || old.refreshToken,
    idToken: body.id_token || old.idToken,
    scopes: body.scope === undefined ? (old.scopes || []) : body.scope.split(/\s+/),
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  });
  const cancelLogin = () => {
    if (!login) return;
    clearTimeout(login.timer); login.server.close(); login = null;
  };
  const signIn = async ({ profileId = data.activeId || data.profiles.findLast((p) => !p.subject)?.id, newProfile = false, consent = false } = {}) => {
    cancelLogin(); lastError = null;
    const profile = newProfile ? null : data.profiles.find((p) => p.id === profileId);
    if (profileId && !newProfile && !profile) throw new ChatGPTError("Unknown ChatGPT account", "invalid_profile", 400);
    const attempt = { state: random(), nonce: random(), verifier: random(), profile, busy: false };
    attempt.server = createServer(async (req, res) => {
      const url = new URL(req.url, attempt.redirectUri);
      if (url.pathname !== "/auth/callback" || login !== attempt || url.searchParams.get("state") !== attempt.state || attempt.busy) {
        res.writeHead(400); res.end("Invalid sign-in callback."); return;
      }
      attempt.busy = true;
      let stage = "callback validation";
      try {
        if (url.searchParams.has("error")) throw new Error("ChatGPT sign-in was declined or cancelled.");
        const clientId = url.searchParams.get("client_id") || profile?.clientId;
        if (!clientId || clientId === "dynamic_agent_client" || (profile && clientId !== profile.clientId)) throw new Error("ChatGPT registration did not match this account.");
        const code = url.searchParams.get("code");
        if (!code) throw new Error("ChatGPT did not return an authorization code.");
        // Retain issued registration even if exchange fails, without activating unverified identity.
        let registration = profile;
        if (!registration) {
          registration = { id: randomUUID(), clientId, scopes: [] };
          data.profiles.push(registration); await store.save();
        }
        stage = "token exchange";
        const body = await tokenRequest({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE });
        stage = "identity verification";
        const identity = await verify(body.id_token, clientId, attempt.nonce);
        if (registration.subject && identity.sub !== registration.subject) throw new Error("ChatGPT account identity changed. Add it as another account.");
        if (login !== attempt) throw new Error("Sign-in was cancelled.");
        stage = "saving the connection";
        Object.assign(registration, credentials(body), { subject: identity.sub, email: identity.email || null });
        data.activeId = registration.id; await store.save();
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("Job Search Companion is connected. Return to extension settings to enable background checks.");
      } catch (error) {
        // Report a bounded diagnostic code, never raw errors containing tokens or callback URLs.
        const claim = ["iss", "aud", "sub", "exp", "nonce"].includes(error.claim) ? `: ${error.claim}` : "";
        const diagnostic = /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code || "") ? ` (${error.code}${claim})` : "";
        lastError = error instanceof ChatGPTError ? error.message : `ChatGPT sign-in failed during ${stage}${diagnostic}. Please try again.`;
        res.writeHead(400, { "Content-Type": "text/plain", "Cache-Control": "no-store" }); res.end(lastError);
      } finally { if (login === attempt) cancelLogin(); }
    });
    await new Promise((resolve, reject) => { attempt.server.once("error", reject); attempt.server.listen(0, "127.0.0.1", resolve); });
    attempt.redirectUri = `http://127.0.0.1:${attempt.server.address().port}/auth/callback`;
    login = attempt;
    attempt.timer = setTimeout(() => { lastError = "Sign-in timed out. Please try again."; cancelLogin(); }, 5 * 60_000);
    attempt.timer.unref();
    const params = new URLSearchParams({ client_id: profile?.clientId || "dynamic_agent_client", ext_agent_host_id: data.hostId, response_type: "code", redirect_uri: attempt.redirectUri, scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url") });
    if (!profile) params.set("agent_name_hint", "Job Search Companion");
    if (profile?.idToken) params.set("id_token_hint", profile.idToken);
    if (profile?.email) params.set("login_hint", profile.email);
    if (consent) params.set("prompt", "consent");
    return { authUrl: `${AUTH}/api/accounts/authorize?${params}` };
  };
  const accessToken = async () => {
    const p = active();
    if (!p?.accessToken || !p.scopes.includes("chatgpt.tokens.use.direct")) throw new ChatGPTError("Connect ChatGPT and enable plan usage in settings.", "plan_usage_disabled", 401);
    if (p.expiresAt > Date.now() + 60_000) return p.accessToken;
    if (!refresh) {
      refresh = Promise.resolve().then(async () => {
        try {
          if (!p.refreshToken) throw new ChatGPTError("Reconnect ChatGPT in settings.", "invalid_refresh_token", 401);
          const body = await tokenRequest({ grant_type: "refresh_token", client_id: p.clientId, refresh_token: p.refreshToken, resource: RESOURCE });
          Object.assign(p, credentials(body, p)); await store.save();
        } catch (error) {
          if (terminalRefreshErrors.has(error.code)) {
            delete p.accessToken; delete p.refreshToken; delete p.idToken; await store.save();
          }
          throw error;
        }
      }).finally(() => { refresh = null; });
    }
    await refresh;
    if (active() !== p) throw new ChatGPTError("ChatGPT account changed. Retry the check.", "account_changed", 409);
    return p.accessToken;
  };
  const request = async (endpoint, options = {}) => {
    const token = await accessToken();
    const response = await fetchImpl(`${RESOURCE}/${endpoint}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: options.signal || AbortSignal.timeout(30_000) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = body.error?.code || `http_${response.status}`;
      const message = response.status === 429 ? "ChatGPT plan usage limit reached. Manage usage in settings, then resume checks."
        : response.status === 401 ? "ChatGPT needs to reconnect. Open extension settings."
        : response.status === 403 ? "ChatGPT plan usage is unavailable for this account or request."
        : "ChatGPT request failed. Retry later or check extension settings.";
      const error = new ChatGPTError(message, code, response.status);
      error.requestId = response.headers.get("x-request-id");
      throw error;
    }
    return response;
  };
  return {
    session, signIn, cancelLogin, request,
    async select(id) {
      if (refresh || login) throw new ChatGPTError("Wait for the current sign-in or refresh to finish.", "auth_busy", 409);
      if (!data.profiles.some((p) => p.id === id)) throw new ChatGPTError("Unknown ChatGPT account", "invalid_profile", 400);
      data.activeId = id; await store.save(); return session();
    },
    async logout() {
      cancelLogin(); if (refresh) await refresh.catch(() => {});
      const p = active(); let revoked = !p?.refreshToken;
      if (p?.refreshToken) {
        try {
          const r = await fetchImpl(`${AUTH}/api/accounts/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: p.refreshToken, token_type_hint: "refresh_token", client_id: p.clientId }), signal: AbortSignal.timeout(10_000) });
          revoked = r.ok;
        } catch { /* Local logout still completes. */ }
      }
      if (p) { delete p.accessToken; delete p.refreshToken; delete p.idToken; await store.save(); }
      lastError = revoked ? null : "Signed out locally. Remote revocation was not confirmed; disconnect the app in ChatGPT Settings.";
      return session();
    },
    async models() {
      const response = await request("models"); const body = await response.json();
      if (!Array.isArray(body.models)) throw new ChatGPTError("ChatGPT returned an invalid model catalog");
      return body.models.filter((m) => m.visibility === "list").map((m) => ({ slug: m.slug, name: m.display_name }));
    },
    close: cancelLogin,
  };
};
