import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBlockerChecker } from "../../../bridge/blockers/checker.js";
import { drainEventLoopUntil, waitUntil } from "../../../test-support/async.js";

const profile = { hash: "profile-v1", facts: [{ id: "F1", text: "Provisional UK driving licence only.", source: "Profile evidence" }], sources: [] };
const job = (id = "job111111") => ({ jobUrl: `https://uk.indeed.com/viewjob?jk=${id}`, description: "You must hold a full UK driving licence to visit customer sites in this role." });
const noBlockers = { outcome: "no_blockers_found", findings: [] };
const setup = async (infer, readEvidence = async () => profile) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-blockers-"));
  const chatgpt = { connectionStatus: () => ({ planUsageEnabled: true, activeId: "account1" }), models: async () => [{ slug: "test-model" }], close() {} };
  const checker = await openBlockerChecker({ directory, profileSources: [], chatgpt, infer, evidenceProvider: { readCurrent: readEvidence, prepareCurrent: readEvidence } });
  await checker.configure({ enabled: true, model: "test-model" });
  return { checker, directory, chatgpt };
};
test("checker deduplicates across tabs, persists results, and invalidates profile or description changes", async () => {
  let calls = 0;
  let currentProfile = profile;
  const { checker, directory, chatgpt } = await setup(async () => {
    calls++;
    return noBlockers;
  }, async () => currentProfile);
  const initialCheck = await checker.start(job());
  const duplicateCheck = await checker.start(job());
  assert.equal(initialCheck.id, duplicateCheck.id);
  await drainEventLoopUntil(() => checker.get(initialCheck.id).status === "completed", { attempts: 100 });
  assert.equal(checker.get(initialCheck.id).status, "completed");
  assert.equal((await checker.start(job())).cached, true);
  assert.equal(calls, 1);
  currentProfile = { ...profile, hash: "profile-v2" };
  const changed = await checker.start(job());
  await waitUntil(() => checker.get(changed.id).status === "completed");
  assert.equal(calls, 2);
  const changedText = await checker.start({ ...job(), description: job().description + " Travel every day." });
  await waitUntil(() => checker.get(changedText.id).status === "completed");
  assert.equal(calls, 3);
  checker.close();
  const restored = await openBlockerChecker({
    directory,
    profileSources: [],
    chatgpt,
    infer: async () => { throw new Error("Should be cached"); },
    evidenceProvider: {
      readCurrent: async () => currentProfile,
      prepareCurrent: async () => currentProfile,
    },
  });
  assert.equal((await restored.start(job())).cached, true);
  assert.equal((await stat(join(directory, "cache.json"))).mode & 0o777, 0o600);
  restored.close();
});

test("newer selections outrank waiting checks and disabling checks rejects new work", async () => {
  let releaseRunningCheck;
  const order = [];
  const { checker } = await setup(async ({ description }) => {
    order.push(description);
    if (order.length === 1) {
      await new Promise((resolve) => { releaseRunningCheck = resolve; });
    }
    return noBlockers;
  });
  const runningCheck = await checker.start(job("first1111"));
  const olderQueuedCheck = await checker.start({
    ...job("second111"), description: job().description + " Second.",
  });
  const newerQueuedCheck = await checker.start({
    ...job("third1111"), description: job().description + " Third.",
  });
  releaseRunningCheck();
  await waitUntil(() => checker.get(olderQueuedCheck.id).status === "completed", { attempts: 100 });
  assert.equal(checker.get(olderQueuedCheck.id).status, "completed");
  assert.ok(order[1].endsWith("Third."));
  assert.equal(checker.get(runningCheck.id).status, "completed");
  assert.equal(checker.get(newerQueuedCheck.id).status, "completed");

  await checker.configure({ enabled: false });
  await assert.rejects(checker.start(job("fourth111")), /off/);
  checker.close();
});

test("clearing the cache during a running check prevents a late result from being saved", async () => {
  let resolve;
  const { checker, directory } = await setup(async () => {
    await new Promise((finish) => { resolve = finish; });
    return noBlockers;
  });
  const task = await checker.start(job());
  await checker.clearCache();
  resolve();
  await drainEventLoopUntil(() => checker.get(task.id).status === "cancelled");
  assert.deepEqual(JSON.parse(await readFile(join(directory, "cache.json"), "utf8")).results, {});
  checker.close();
});

test("limit errors pause inference without caching a clean outcome or billing fallback", async () => {
  let calls = 0;
  const { checker } = await setup(async () => {
    calls++;
    throw Object.assign(new Error("Usage limit reached"), { status: 429 });
  });
  const task = await checker.start(job());
  await drainEventLoopUntil(() => checker.get(task.id).status === "failed");
  await assert.rejects(checker.start(job()), /Usage limit/);
  assert.equal(calls, 1);
  assert.equal(checker.get(task.id).result, undefined);
  checker.close();
});

test("checker refuses LinkedIn, short descriptions and unadvertised models", async () => {
  const { checker } = await setup(async () => noBlockers);
  await assert.rejects(checker.start({ ...job(), jobUrl: "https://www.linkedin.com/jobs/view/123456789/" }), /Indeed/);
  await assert.rejects(checker.start({ ...job(), description: "short" }), /full job description/);
  await assert.rejects(checker.configure({ model: "not-available" }), /available/);
  checker.close();
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

test("indexing model is selected independently and validates catalog availability", async () => {
  const { checker, chatgpt, directory } = await setup(async () => noBlockers);
  chatgpt.models = async () => [{ slug: "gpt-6-luna" }, { slug: "gpt-6-sol" }];
  await checker.configure({ model: "gpt-6-luna", indexModel: "gpt-6-sol" });
  const status = await checker.status();
  assert.equal(status.settings.model, "gpt-6-luna");
  assert.equal(status.settings.indexModel, "gpt-6-sol");
  assert.equal(JSON.parse(await readFile(join(directory, "settings.json"), "utf8")).indexModel, "gpt-6-sol");
  await assert.rejects(checker.configure({ indexModel: "invented-model" }), /available/);
  await checker.configure({ indexModel: null });
  assert.equal((await checker.status()).settings.indexModel, null);
  checker.close();
});

test("result waits wake all tabs on completion and return finished checks immediately", async (t) => {
  let release;
  const { checker } = await setup(async () => {
    await new Promise((resolve) => { release = resolve; });
    return noBlockers;
  });
  t.after(() => checker.close());
  const check = await checker.start(job());
  const first = checker.wait(check.id);
  const second = checker.wait(check.id);
  let finished = false;
  first.then(() => { finished = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  release();
  const results = await Promise.all([first, second]);
  assert.ok(results.every((result) => result.status === "completed"));
  assert.deepEqual(await checker.wait(check.id), results[0]);
  await assert.rejects(checker.wait("missing"), /no longer available/);
});

test("result waits expire without cancelling inference and disconnected tabs can wait again", async (t) => {
  let release;
  const { checker } = await setup(async () => {
    await new Promise((resolve) => { release = resolve; });
    return noBlockers;
  });
  t.after(() => checker.close());
  const check = await checker.start(job());
  assert.equal((await checker.wait(check.id, { timeoutMs: 5 })).status, "checking");
  const controller = new AbortController();
  const disconnected = checker.wait(check.id, { signal: controller.signal });
  controller.abort();
  await assert.rejects(disconnected, { name: "AbortError" });
  await assert.rejects(checker.wait(check.id, { signal: controller.signal }), { name: "AbortError" });
  const connected = checker.wait(check.id);
  release();
  assert.equal((await connected).status, "completed");
});

test("result waits wake for queued cancellation and failed checks", async (t) => {
  let release;
  const { checker } = await setup(async () => {
    await new Promise((resolve) => { release = resolve; });
    throw new Error("Inference failed");
  });
  t.after(() => checker.close());
  const running = await checker.start(job());
  const queued = await checker.start(job("queued111"));
  const runningWait = checker.wait(running.id);
  const queuedWait = checker.wait(queued.id);
  await checker.configure({ enabled: false });
  assert.equal((await queuedWait).status, "cancelled");
  release();
  assert.equal((await runningWait).status, "cancelled");
  await checker.configure({ enabled: true });
  const failure = await checker.start(job());
  const failureWait = checker.wait(failure.id);
  release();
  assert.equal((await failureWait).status, "failed");
});

test("queued tabs receive the checking transition as soon as their job starts", async (t) => {
  const releases = [];
  const { checker } = await setup(async () => {
    await new Promise((resolve) => { releases.push(resolve); });
    return noBlockers;
  });
  t.after(() => checker.close());
  const first = await checker.start(job());
  const queued = await checker.start(job("queued111"));
  const firstWait = checker.wait(first.id);
  const queuedWait = checker.wait(queued.id);
  releases[0]();
  assert.equal((await firstWait).status, "completed");
  assert.equal((await queuedWait).status, "checking");
  const completion = checker.wait(queued.id);
  releases[1]();
  assert.equal((await completion).status, "completed");
});

test("accepted challenge integrates the profile and future checks use the correction without replaying notes", async () => {
  const { writeFile } = await import("node:fs/promises");
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-challenge-"));
  const path = join(directory, "profile.md");
  await writeFile(path, "## Personal Constraints\n- Provisional UK driving licence only.\n");
  const received = [];
  let release;
  const chatgpt = { connectionStatus: () => ({ planUsageEnabled: true, activeId: "account1" }), models: async () => [{ slug: "test-model" }], close() {} };
  const checker = await openBlockerChecker({ directory, profileSources: [{ kind: "application", path }], chatgpt,
    infer: async (input) => {
      received.push(input);
      if (input.challenge) await new Promise((resolve) => { release = resolve; });
      return input.challenge ? { ...noBlockers,
        challengeReview: { accepted: true, requirementQuote: "full UK driving licence", response: "The full licence satisfies this requirement." },
        profileUpdates: [{ text: "Holds a full UK driving licence.", replacesFactIds: ["F1"] }] } : noBlockers;
    } });
  try {
    await checker.configure({ enabled: true, model: "test-model" });
    const before = (await checker.status()).evidence.hash;
    const challenge = { requirementQuote: "full UK driving licence", reason: "I passed my test." };
    const check = await checker.start({ ...job(), challenge });
    await waitUntil(() => release);
    const queued = await checker.start(job("queued111"));
    release();
    await waitUntil(() => checker.get(check.id).status === "completed");
    await waitUntil(() => checker.get(queued.id).status === "completed");
    assert.equal((await checker.start(job())).cached, true);
    const result = checker.get(check.id).result;
    assert.equal(result.challengeReview.profileUpdated, true);
    assert.notEqual(result.evidenceHash, before);
    assert.equal(result.evidenceHash, (await checker.status()).evidence.hash);
    assert.doesNotMatch(await readFile(path, "utf8"), /Provisional/);
    assert.deepEqual(received[1].challenge, null);
    assert.equal(received[1].evidence.facts[0].text, "Holds a full UK driving licence.");
    const later = await checker.start(job("future111"));
    await waitUntil(() => checker.get(later.id).status === "completed");
    assert.deepEqual(received[1].challenge, null);
    assert.equal(received[1].evidence.facts[0].text, "Holds a full UK driving licence.");
    const persisted = await readFile(join(directory, "cache.json"), "utf8");
    assert.doesNotMatch(persisted, /I passed my test|profileUpdates|replacesFactIds/);
    await assert.rejects(checker.start({ ...job(), challenge: { ...challenge, reason: " " } }), /challenge must/);
    await assert.rejects(checker.start({ ...job(), challenge: { ...challenge, requirementQuote: "invented" } }), /challenge must/);
  } finally {
    checker.close();
  }
});
