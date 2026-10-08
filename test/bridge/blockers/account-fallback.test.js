import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBlockerChecker } from "../../../bridge/blockers/checker.js";
import { openChatGPTAccountManager } from "../../../bridge/blockers/chatgpt-accounts.js";
import { drainEventLoopUntil } from "../../../test-support/async.js";

const profile = { hash: "verified", facts: [{ id: "F1", text: "Provisional licence" }], sources: [] };
const job = (id = "first1111") => ({ jobUrl: `https://uk.indeed.com/viewjob?jk=${id}`, description: "You must hold a full UK driving licence to visit customer sites in this role." });
const result = { outcome: "no_blockers_found", findings: [] };
const quota = () => Object.assign(new Error("Usage limit reached"), { status: 429, code: "subscription_sharing_usage_limit_exceeded" });
const fixture = async (t, infer, models = async () => [{ slug: "test" }]) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-fallback-"));
  let activeId = "a";
  const selected = [];
  const chatgpt = {
    connectionStatus: () => ({ activeId, planUsageEnabled: true }),
    fallbackAccountIds: () => ["b", "c"],
    select: async (id) => { selected.push(id); activeId = id; },
    models: () => models(activeId), close() {},
  };
  const checker = await openBlockerChecker({ directory, chatgpt, readProfile: async () => profile, infer });
  t.after(async () => { checker.close(); await rm(directory, { recursive: true, force: true }); });
  await checker.configure({ enabled: true, model: "test", accountFallback: true });
  return { checker, chatgpt, selected };
};
const settle = async (checker, task) => {
  await drainEventLoopUntil(() => ["completed", "failed", "cancelled"].includes(checker.get(task.id).status), 200);
  return checker.get(task.id);
};

test("confirmed usage exhaustion retries the same check and queued jobs continue on the fallback", async (t) => {
  const calls = []; let release;
  const { checker, chatgpt, selected } = await fixture(t, async ({ chatgpt, model, description }) => {
    calls.push({ account: chatgpt.connectionStatus().activeId, model, description });
    if (calls.length === 1) { await new Promise((resolve) => { release = resolve; }); throw quota(); }
    return result;
  });
  const first = await checker.start(job());
  const queued = await checker.start(job("second111"));
  release();
  assert.equal((await settle(checker, first)).status, "completed");
  assert.equal((await settle(checker, queued)).status, "completed");
  assert.deepEqual(calls.map((c) => c.account), ["a", "b", "b"]);
  assert.ok(calls.every((c) => c.model === "test" && c.description === job().description));
  assert.deepEqual(selected, ["b"]);
  assert.equal(chatgpt.connectionStatus().activeId, "b");
  assert.equal((await checker.status()).pausedReason, null);
});

test("all exhausted accounts are tried once then checks pause without caching an outcome", async (t) => {
  const calls = [];
  const { checker } = await fixture(t, async ({ chatgpt }) => { calls.push(chatgpt.connectionStatus().activeId); throw quota(); });
  const task = await checker.start(job());
  assert.equal((await settle(checker, task)).status, "failed");
  assert.deepEqual(calls, ["a", "b", "c"]);
  assert.equal(task.result, undefined);
  assert.match((await checker.status()).pausedReason, /No connected fallback/);
  await assert.rejects(checker.start(job()), /No connected fallback/);
});

for (const failure of [Object.assign(new Error("Rate limited"), { status: 429, code: "rate_limit_exceeded" }), Object.assign(new Error("Reconnect"), { status: 401 }), new Error("Network failure")]) {
  test(`does not rotate accounts for ${failure.message}`, async (t) => {
    const { checker, selected } = await fixture(t, async () => { throw failure; });
    assert.equal((await settle(checker, await checker.start(job()))).status, "failed");
    assert.deepEqual(selected, []);
  });
}

test("fallback can be disabled and rejects invalid settings", async (t) => {
  const { checker, selected } = await fixture(t, async () => { throw quota(); });
  await assert.rejects(checker.configure({ accountFallback: "true" }), /Invalid/);
  await checker.configure({ accountFallback: false });
  assert.equal((await settle(checker, await checker.start(job()))).status, "failed");
  assert.deepEqual(selected, []);
});

for (const reason of ["missing model", "disconnected", "exhausted catalog"]) {
  test(`skips fallback with ${reason}`, async (t) => {
    const calls = [];
    const { checker, selected } = await fixture(t, async ({ chatgpt }) => {
      calls.push(chatgpt.connectionStatus().activeId);
      if (chatgpt.connectionStatus().activeId === "a") throw quota();
      return result;
    }, async (id) => {
      if (id === "b") {
        if (reason === "disconnected") throw Object.assign(new Error("Reconnect"), { status: 401 });
        if (reason === "exhausted catalog") throw quota();
        return [{ slug: "other" }];
      }
      return [{ slug: "test" }];
    });
    assert.equal((await settle(checker, await checker.start(job()))).status, "completed");
    assert.deepEqual(selected, ["b", "c"]);
    assert.deepEqual(calls, ["a", "c"]);
  });
}

test("pausing during fallback model lookup prevents inference and further switches", async (t) => {
  let release; const calls = [];
  const { checker, selected } = await fixture(t, async ({ chatgpt }) => { calls.push(chatgpt.connectionStatus().activeId); throw quota(); }, async (id) => {
    if (id === "b") await new Promise((resolve) => { release = resolve; });
    return [{ slug: "test" }];
  });
  const task = await checker.start(job());
  await drainEventLoopUntil(() => Boolean(release));
  await checker.configure({ enabled: false }); release();
  assert.equal((await settle(checker, task)).status, "cancelled");
  assert.deepEqual(calls, ["a"]); assert.deepEqual(selected, ["b"]);
  assert.equal((await checker.status()).pausedReason, null);
});

test("fallback candidates exclude incomplete, signed-out, unconsented and duplicate subscribers", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-fallback-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "chatgpt.json");
  const registration = (id, subject, patch = {}) => ({ id, subject, clientId: `client_${id}`, accessToken: "secret", scopes: ["chatgpt.tokens.use.direct"], ...patch });
  await writeFile(path, JSON.stringify({ hostId: "host", activeId: "a", accounts: [
    registration("a", "user1"), registration("duplicate-a", "user1"), registration("b", "user2"), registration("duplicate-b", "user2"),
    registration("incomplete", undefined), registration("signed-out", "user3", { accessToken: null }), registration("unconsented", "user4", { scopes: [] }), registration("c", "user5"),
  ] }));
  const auth = await openChatGPTAccountManager({ path }); t.after(() => auth.close());
  assert.deepEqual(auth.fallbackAccountIds(), ["b", "c"]);
  assert.deepEqual(auth.connectionStatus().fallbackIds, ["b", "c"]);
  assert.doesNotMatch(JSON.stringify(auth.connectionStatus()), /secret|user1|user2/);
});
