import { createServer } from "node:http";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, customFetch } from "jose";
import { openPrivateStore } from "./private-store.js";

const AUTH_ORIGIN = "https://auth.openai.com";
const API_BASE_URL = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const createOAuthSecret = () => randomBytes(32).toString("base64url");
const terminalRefreshErrors = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

export class ChatGPTError extends Error {
  constructor(message, code = "connection_error", status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const openChatGPTAccountManager = async ({ path, fetchImpl = fetch, verifyIdentity }) => {
  const store = await openPrivateStore(path, {
    hostId: `urn:uuid:${randomUUID()}`,
    activeId: null,
    accounts: [],
  });
  if (Object.hasOwn(store.value, "profiles")) {
    if (store.value.accounts)
      throw new Error("Conflicting ChatGPT account stores; no credentials were changed");
    store.value.accounts = store.value.profiles;
    delete store.value.profiles;
  }
  await store.save();
  const data = store.value;
  const jwks = createRemoteJWKSet(new URL(`${AUTH_ORIGIN}/.well-known/jwks.json`), {
    [customFetch]: fetchImpl,
  });
  const verify =
    verifyIdentity ||
    (async (token, clientId, nonce) => {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: AUTH_ORIGIN,
        audience: clientId,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", "nonce"],
      });
      if (payload.nonce !== nonce || !payload.sub)
        throw new Error("ChatGPT identity validation failed");
      return payload;
    });
  let pendingSignIn = null;
  let refreshPromise = null;
  let lastError = null;
  const active = () => data.accounts.find((account) => account.id === data.activeId);
  const fallbackAccountIds = () => {
    // Registrations for the same subscriber share usage; never rotate between them.
    const seen = new Set([active()?.subject]);
    return data.accounts
      .filter((account) => {
        if (
          !account.subject ||
          seen.has(account.subject) ||
          !account.accessToken ||
          !account.scopes.includes("chatgpt.tokens.use.direct")
        )
          return false;
        seen.add(account.subject);
        return true;
      })
      .map((account) => account.id);
  };
  const connectionStatus = () => {
    const account = active();
    return {
      connected: Boolean(account?.accessToken),
      planUsageEnabled: Boolean(
        account?.accessToken && account.scopes.includes("chatgpt.tokens.use.direct"),
      ),
      activeId: data.activeId,
      accounts: data.accounts.map(({ id, email, subject, clientId }) => ({
        id,
        email,
        label: `${email || (subject ? "ChatGPT account" : "Incomplete sign-in")} · ${clientId.slice(-8)}`,
      })),
      fallbackIds: fallbackAccountIds(),
      pending: Boolean(pendingSignIn),
      error: lastError,
    };
  };
  const tokenRequest = async (params) => {
    const response = await fetchImpl(`${AUTH_ORIGIN}/api/accounts/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json();
    if (!response.ok)
      throw new ChatGPTError(
        "ChatGPT authentication failed. Try reconnecting in settings.",
        body.error || "auth_error",
        response.status,
      );
    if (!body.access_token || body.token_type?.toLowerCase() !== "bearer")
      throw new ChatGPTError("ChatGPT returned an invalid token response");
    return body;
  };
  const credentials = (body, old = {}) => ({
    accessToken: body.access_token,
    refreshToken: body.refresh_token || old.refreshToken,
    idToken: body.id_token || old.idToken,
    scopes: body.scope === undefined ? old.scopes || [] : body.scope.split(/\s+/),
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  });
  const cancelSignIn = () => {
    if (!pendingSignIn) return;
    clearTimeout(pendingSignIn.timer);
    pendingSignIn.server.close();
    pendingSignIn = null;
  };
  const signIn = async ({
    accountId = data.activeId || data.accounts.findLast((account) => !account.subject)?.id,
    newAccount = false,
    consent = false,
  } = {}) => {
    cancelSignIn();
    lastError = null;
    const account = newAccount ? null : data.accounts.find((account) => account.id === accountId);
    if (accountId && !newAccount && !account)
      throw new ChatGPTError("Unknown ChatGPT account", "invalid_account", 400);
    const attempt = {
      state: createOAuthSecret(),
      nonce: createOAuthSecret(),
      verifier: createOAuthSecret(),
      account,
      busy: false,
    };
    attempt.server = createServer(async (req, res) => {
      const url = new URL(req.url, attempt.redirectUri);
      if (
        url.pathname !== "/auth/callback" ||
        pendingSignIn !== attempt ||
        url.searchParams.get("state") !== attempt.state ||
        attempt.busy
      ) {
        res.writeHead(400);
        res.end("Invalid sign-in callback.");
        return;
      }
      attempt.busy = true;
      let stage = "callback validation";
      try {
        if (url.searchParams.has("error"))
          throw new Error("ChatGPT sign-in was declined or cancelled.");
        const clientId = url.searchParams.get("client_id") || account?.clientId;
        if (
          !clientId ||
          clientId === "dynamic_agent_client" ||
          (account && clientId !== account.clientId)
        )
          throw new Error("ChatGPT registration did not match this account.");
        const code = url.searchParams.get("code");
        if (!code) throw new Error("ChatGPT did not return an authorization code.");
        // Retain issued registration even if exchange fails, without activating unverified identity.
        let registration = account;
        if (!registration) {
          registration = { id: randomUUID(), clientId, scopes: [] };
          data.accounts.push(registration);
          await store.save();
        }
        stage = "token exchange";
        const body = await tokenRequest({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: attempt.verifier,
          redirect_uri: attempt.redirectUri,
          resource: API_BASE_URL,
        });
        stage = "identity verification";
        const identity = await verify(body.id_token, clientId, attempt.nonce);
        if (registration.subject && identity.sub !== registration.subject)
          throw new Error("ChatGPT account identity changed. Add it as another account.");
        if (pendingSignIn !== attempt) throw new Error("Sign-in was cancelled.");
        stage = "saving the connection";
        Object.assign(registration, credentials(body), {
          subject: identity.sub,
          email: identity.email || null,
        });
        data.activeId = registration.id;
        await store.save();
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(
          "Job Search Companion is connected. Return to extension settings to enable blocker checks.",
        );
      } catch (error) {
        // Report a bounded diagnostic code, never raw errors containing tokens or callback URLs.
        const claim = ["iss", "aud", "sub", "exp", "nonce"].includes(error.claim)
          ? `: ${error.claim}`
          : "";
        const diagnostic = /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code || "")
          ? ` (${error.code}${claim})`
          : "";
        lastError =
          error instanceof ChatGPTError
            ? error.message
            : `ChatGPT sign-in failed during ${stage}${diagnostic}. Please try again.`;
        res.writeHead(400, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
        });
        res.end(lastError);
      } finally {
        if (pendingSignIn === attempt) cancelSignIn();
      }
    });
    await new Promise((resolve, reject) => {
      attempt.server.once("error", reject);
      attempt.server.listen(0, "127.0.0.1", resolve);
    });
    attempt.redirectUri = `http://127.0.0.1:${attempt.server.address().port}/auth/callback`;
    pendingSignIn = attempt;
    attempt.timer = setTimeout(() => {
      lastError = "Sign-in timed out. Please try again.";
      cancelSignIn();
    }, 5 * 60_000);
    attempt.timer.unref();
    const params = new URLSearchParams({
      client_id: account?.clientId || "dynamic_agent_client",
      ext_agent_host_id: data.hostId,
      response_type: "code",
      redirect_uri: attempt.redirectUri,
      scope: SCOPES,
      resource: API_BASE_URL,
      state: attempt.state,
      nonce: attempt.nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url"),
    });
    if (!account) params.set("agent_name_hint", "Job Search Companion");
    if (account?.idToken) params.set("id_token_hint", account.idToken);
    if (account?.email) params.set("login_hint", account.email);
    if (consent) params.set("prompt", "consent");
    return { authUrl: `${AUTH_ORIGIN}/api/accounts/authorize?${params}` };
  };
  const accessToken = async () => {
    const account = active();
    if (!account?.accessToken || !account.scopes.includes("chatgpt.tokens.use.direct"))
      throw new ChatGPTError(
        "Connect ChatGPT and enable plan usage in settings.",
        "plan_usage_disabled",
        401,
      );
    if (account.expiresAt > Date.now() + 60_000) return account.accessToken;
    if (!refreshPromise) {
      refreshPromise = Promise.resolve()
        .then(async () => {
          try {
            if (!account.refreshToken)
              throw new ChatGPTError(
                "Reconnect ChatGPT in settings.",
                "invalid_refresh_token",
                401,
              );
            const body = await tokenRequest({
              grant_type: "refresh_token",
              client_id: account.clientId,
              refresh_token: account.refreshToken,
              resource: API_BASE_URL,
            });
            Object.assign(account, credentials(body, account));
            await store.save();
          } catch (error) {
            if (terminalRefreshErrors.has(error.code)) {
              delete account.accessToken;
              delete account.refreshToken;
              delete account.idToken;
              await store.save();
            }
            throw error;
          }
        })
        .finally(() => {
          refreshPromise = null;
        });
    }
    await refreshPromise;
    if (active() !== account)
      throw new ChatGPTError("ChatGPT account changed. Retry the check.", "account_changed", 409);
    return account.accessToken;
  };
  const request = async (endpoint, options = {}) => {
    const token = await accessToken();
    const response = await fetchImpl(`${API_BASE_URL}/${endpoint}`, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
      signal: options.signal || AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const code = body.error?.code || `http_${response.status}`;
      const message =
        code === "subscription_sharing_usage_limit_exceeded"
          ? "ChatGPT plan usage limit reached. Manage usage in settings, then resume checks."
          : response.status === 429
            ? "ChatGPT is temporarily rate limited. Wait before resuming checks."
            : response.status === 401
              ? "ChatGPT needs to reconnect. Open extension settings."
              : response.status === 403
                ? "ChatGPT plan usage is unavailable for this account or request."
                : "ChatGPT request failed. Retry later or check extension settings.";
      const error = new ChatGPTError(message, code, response.status);
      error.requestId = response.headers.get("x-request-id");
      throw error;
    }
    return response;
  };
  return {
    connectionStatus,
    signIn,
    cancelSignIn,
    request,
    fallbackAccountIds,
    async select(id) {
      if (refreshPromise || pendingSignIn)
        throw new ChatGPTError(
          "Wait for the current sign-in or refresh to finish.",
          "auth_busy",
          409,
        );
      if (!data.accounts.some((account) => account.id === id))
        throw new ChatGPTError("Unknown ChatGPT account", "invalid_account", 400);
      data.activeId = id;
      await store.save();
      return connectionStatus();
    },
    async logout() {
      cancelSignIn();
      if (refreshPromise) await refreshPromise.catch(() => {});
      const account = active();
      let revoked = !account?.refreshToken;
      if (account?.refreshToken) {
        try {
          const revokeResponse = await fetchImpl(`${AUTH_ORIGIN}/api/accounts/oauth/revoke`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: account.refreshToken,
              token_type_hint: "refresh_token",
              client_id: account.clientId,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          revoked = revokeResponse.ok;
        } catch {
          /* Local logout still completes. */
        }
      }
      if (account) {
        delete account.accessToken;
        delete account.refreshToken;
        delete account.idToken;
        await store.save();
      }
      lastError = revoked
        ? null
        : "Signed out locally. Remote revocation was not confirmed; disconnect the app in ChatGPT Settings.";
      return connectionStatus();
    },
    async models() {
      const response = await request("models");
      const body = await response.json();
      if (!Array.isArray(body.models))
        throw new ChatGPTError("ChatGPT returned an invalid model catalog");
      return body.models
        .filter((model) => model.visibility === "list")
        .map((model) => ({ slug: model.slug, name: model.display_name }));
    },
    close: cancelSignIn,
  };
};
