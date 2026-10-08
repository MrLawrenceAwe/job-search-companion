import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openChatGPTAccountManager } from "../../../bridge/blockers/chatgpt-accounts.js";

test("OAuth validates state and identity before activating a registration, preserving host ID", async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-auth-")); let nonce; let tokenParams;
  const path = join(directory, "chatgpt.json");
  const auth = await openChatGPTAccountManager({ path, verifyIdentity: async (_token, clientId, expectedNonce) => { assert.equal(clientId, "oaiapp_test"); assert.equal(expectedNonce, nonce); return { sub: "user1", email: "user@example.test" }; }, fetchImpl: async (_url, options) => {
    tokenParams = new URLSearchParams(options.body); return Response.json({ access_token: "test-access", refresh_token: "test-refresh", id_token: "test-id", token_type: "Bearer", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct" });
  } });
  const { authUrl } = await auth.signIn({ newAccount: true }); const url = new URL(authUrl); nonce = url.searchParams.get("nonce");
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client"); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const callback = new URL(url.searchParams.get("redirect_uri")); callback.search = new URLSearchParams({ state: "wrong", code: "code", client_id: "oaiapp_test" });
  assert.equal((await fetch(callback)).status, 400); assert.equal(auth.connectionStatus().connected, false);
  callback.searchParams.set("state", url.searchParams.get("state")); assert.equal((await fetch(callback)).status, 200);
  assert.equal(auth.connectionStatus().planUsageEnabled, true); assert.equal(tokenParams.get("client_id"), "oaiapp_test"); assert.equal(tokenParams.get("redirect_uri"), url.searchParams.get("redirect_uri"));
  assert.doesNotMatch(JSON.stringify(auth.connectionStatus()), /test-access|test-refresh|test-id/);
  const hostId = JSON.parse(await readFile(path)).hostId;
  await auth.logout(); const second = new URL((await auth.signIn()).authUrl);
  assert.equal(second.searchParams.get("ext_agent_host_id"), hostId); assert.equal(second.searchParams.get("client_id"), "oaiapp_test");
  auth.close(); assert.equal((await stat(path)).mode & 0o777, 0o600);
});

for (const code of ["rate_limit_exceeded", "subscription_sharing_usage_limit_exceeded"]) {
  test(`ChatGPT error wording distinguishes ${code}`, async (t) => {
    const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-account-errors-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "chatgpt.json");
    await writeFile(
      path,
      JSON.stringify({
        activeId: "a",
        accounts: [
          {
            id: "a",
            accessToken: "token",
            scopes: ["chatgpt.tokens.use.direct"],
            expiresAt: Date.now() + 3600_000,
          },
        ],
      }),
    );
    const auth = await openChatGPTAccountManager({
      path,
      fetchImpl: async () => Response.json({ error: { code } }, { status: 429 }),
    });
    t.after(() => auth.close());
    await assert.rejects(auth.models(), (error) => {
      assert.equal(error.code, code);
      assert.match(
        error.message,
        code === "rate_limit_exceeded" ? /temporarily rate limited/ : /plan usage limit reached/,
      );
      return true;
    });
  });
}
