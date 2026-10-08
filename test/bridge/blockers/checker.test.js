import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBlockerChecker } from "../../../bridge/blockers/checker.js";
import { drainEventLoopUntil, waitUntil } from "../../../test-support/async.js";

const profile = { hash: "profile-v1", facts: [{ id: "F1", text: "Provisional UK driving licence only.", source: "Verified profile" }], sources: [] };
const job = (id = "job111111") => ({ jobUrl: `https://uk.indeed.com/viewjob?jk=${id}`, description: "You must hold a full UK driving licence to visit customer sites in this role." });
const noBlockers = { outcome: "no_blockers_found", findings: [] };
const setup = async (infer, readProfile = async () => profile) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-blockers-"));
  const chatgpt = { connectionStatus: () => ({ planUsageEnabled: true, activeId: "account1" }), models: async () => [{ slug: "test-model" }], close() {} };
  const checker = await openBlockerChecker({ directory, profileSources: [], chatgpt, infer, readProfile });
  await checker.configure({ enabled: true, model: "test-model" });
  return { checker, directory, chatgpt };
};
test("checker deduplicates across tabs, persists results, and invalidates profile or description changes", async () => {
  let calls = 0; let currentProfile = profile;
  const { checker, directory, chatgpt } = await setup(async () => { calls++; return noBlockers; }, async () => currentProfile);
  const a = await checker.start(job()); const b = await checker.start(job());
  assert.equal(a.id, b.id);
  await drainEventLoopUntil(() => checker.get(a.id).status === "completed", 100);
  assert.equal(checker.get(a.id).status, "completed");
  assert.equal((await checker.start(job())).cached, true); assert.equal(calls, 1);
  currentProfile = { ...profile, hash: "profile-v2" };
  const changed = await checker.start(job()); await drainEventLoopUntil(() => checker.get(changed.id).status === "completed", 100);
  assert.equal(calls, 2);
  const changedText = await checker.start({ ...job(), description: job().description + " Travel every day." });
  await drainEventLoopUntil(() => checker.get(changedText.id).status === "completed", 100);
  assert.equal(calls, 3);
  checker.close();
  const restored = await openBlockerChecker({ directory, profileSources: [], chatgpt, infer: async () => { throw new Error("Should be cached"); }, readProfile: async () => currentProfile });
  assert.equal((await restored.start(job())).cached, true);
  assert.equal((await stat(join(directory, "cache.json"))).mode & 0o777, 0o600); restored.close();
});

test("current selections outrank unstarted checks and pausing cancels waiting work", async () => {
  let resolve; const order = [];
  const { checker } = await setup(async ({ description }) => { order.push(description); if (order.length === 1) await new Promise((r) => { resolve = r; }); return noBlockers; });
  const a = await checker.start(job("first1111"));
  const b = await checker.start({ ...job("second111"), description: job().description + " Second." });
  const c = await checker.start({ ...job("third1111"), description: job().description + " Third." });
  resolve();
  await waitUntil(() => checker.get(b.id).status === "completed", { attempts: 100 });
  assert.equal(checker.get(b.id).status, "completed");
  assert.ok(order[1].endsWith("Third.")); assert.equal(checker.get(a.id).status, "completed"); assert.equal(checker.get(c.id).status, "completed");
  await checker.configure({ enabled: false });
  await assert.rejects(checker.start(job("fourth111")), /off/); checker.close();
});

test("clearing the cache during a running check prevents a late result from being saved", async () => {
  let resolve;
  const { checker, directory } = await setup(async () => { await new Promise((r) => { resolve = r; }); return noBlockers; });
  const task = await checker.start(job()); await checker.clearCache(); resolve();
  await drainEventLoopUntil(() => checker.get(task.id).status === "cancelled");
  assert.deepEqual(JSON.parse(await readFile(join(directory, "cache.json"), "utf8")).results, {}); checker.close();
});

test("limit errors pause inference without caching a clean outcome or billing fallback", async () => {
  let calls = 0;
  const { checker } = await setup(async () => { calls++; throw Object.assign(new Error("Usage limit reached"), { status: 429 }); });
  const task = await checker.start(job()); await drainEventLoopUntil(() => checker.get(task.id).status === "failed");
  await assert.rejects(checker.start(job()), /Usage limit/); assert.equal(calls, 1); assert.equal(checker.get(task.id).result, undefined); checker.close();
});

test("checker refuses LinkedIn, partial input, unavailable profiles and unadvertised models", async () => {
  const { checker } = await setup(async () => noBlockers);
  await assert.rejects(checker.start({ ...job(), jobUrl: "https://www.linkedin.com/jobs/view/123456789/" }), /Indeed/);
  await assert.rejects(checker.start({ ...job(), description: "short" }), /full job description/);
  await assert.rejects(checker.configure({ model: "not-available" }), /available/); checker.close();
});

test("reasoning changes persist, cancel pending work, and invalidate Luna results", async () => {
  const received = [];
  let release;
  const { checker, directory, chatgpt } = await setup(async ({ reasoningEffort }) => {
    received.push(reasoningEffort);
    if (received.length === 2) await new Promise((resolve) => { release = resolve; });
    return noBlockers;
  });
  chatgpt.models = async () => [{ slug: "gpt-6-luna" }];
  await checker.configure({ model: "gpt-6-luna", reasoningEffort: "medium" });
  const first = await checker.start(job());
  await waitUntil(() => checker.get(first.id).status === "completed");
  assert.equal(checker.get(first.id).result.reasoningEffort, "medium");
  assert.equal((await checker.start(job())).cached, true);
  await checker.configure({ reasoningEffort: "low" });
  const second = await checker.start(job());
  assert.equal(second.cached, undefined);
  const queued = await checker.start(job("second111"));
  await checker.configure({ reasoningEffort: "medium" });
  assert.equal(checker.get(queued.id).status, "cancelled");
  release();
  await waitUntil(() => checker.get(second.id).status === "cancelled");
  assert.deepEqual(received, ["medium", "low"]);
  assert.equal((await checker.start(job())).result.reasoningEffort, "medium");
  assert.equal(JSON.parse(await readFile(join(directory, "settings.json"), "utf8")).reasoningEffort, "medium");
  await assert.rejects(checker.configure({ reasoningEffort: "light" }), /Invalid checker settings/);
  checker.close();
});
