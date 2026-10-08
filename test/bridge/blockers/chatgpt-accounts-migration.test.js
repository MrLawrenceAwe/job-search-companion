import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openChatGPTAccountManager } from "../../../bridge/blockers/chatgpt-accounts.js";

const createAccountStorePath = async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-account-storage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "chatgpt.json");
};

test("account field migration preserves registrations and credentials and persists the current contract", async (t) => {
  const path = await createAccountStorePath(t);
  const account = {
    id: "a",
    subject: "subscriber",
    clientId: "client-a",
    accessToken: "token",
    refreshToken: "refresh",
    scopes: ["chatgpt.tokens.use.direct"],
    expiresAt: Date.now() + 3600_000,
  };
  await writeFile(path, JSON.stringify({ hostId: "host", activeId: "a", profiles: [account] }));
  const auth = await openChatGPTAccountManager({ path });
  t.after(() => auth.close());
  assert.equal(auth.connectionStatus().planUsageEnabled, true);
  assert.equal(auth.connectionStatus().accounts[0].id, "a");
  const stored = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(stored.accounts, [account]);
  assert.equal(stored.activeId, "a");
  assert.equal(stored.hostId, "host");
  assert.equal(Object.hasOwn(stored, "profiles"), false);
});

test("conflicting account schemas are rejected without overwriting credentials", async (t) => {
  const path = await createAccountStorePath(t);
  const content = JSON.stringify({ accounts: [], profiles: [{ accessToken: "preserve" }] });
  await writeFile(path, content);
  await assert.rejects(openChatGPTAccountManager({ path }), /Conflicting ChatGPT account stores/);
  assert.equal(await readFile(path, "utf8"), content);
});
