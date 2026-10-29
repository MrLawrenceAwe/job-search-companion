import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { runScriptsInVm } from "../../../test-support/extension-scripts.js";

const job = (id) => ({ jobUrl: `https://uk.indeed.com/viewjob?jk=${id}`, title: "Support advisor", company: "Example", location: "London", pay: "£30,000" });
const sender = { id: "test-extension", frameId: 0, tab: { id: 7 }, url: "https://example.org/" };
const setup = async ({ jobs = [job("fixture111")], status = "ready", age = 0, checkStatus = "completed", findings = [] } = {}) => {
  const saved = {};
  const opened = [];
  const submissions = [];
  const reviews = [];
  let now = Date.now();
  const batch = { status, collectedAt: new Date(now - age).toISOString(), jobs };
  const context = vm.createContext({ URL, Date: class extends Date { static now() { return now; } }, chrome: {
    storage: { local: {
      get: async (keys) => Object.fromEntries((keys === null ? Object.keys(saved) : Array.isArray(keys) ? keys : [keys]).filter((key) => key in saved).map((key) => [key, saved[key]])),
      set: async (values) => Object.assign(saved, values),
    } },
    tabs: { create: async (options) => opened.push(options) },
    runtime: { id: "test-extension" },
  } });
  await runScriptsInVm(context, ["contracts/job-urls.js", "contracts/job-storage-keys.js", "contracts/identifiers.js", "contracts/job-analyses.js", "contracts/recommendations.js", "contracts/messages.js", "worker/recommendations.js"]);
  let currentCheck = checkStatus;
  const service = context.jobSearchWorkerModules.createRecommendationService({
    bridgeConfig: { bridgeToken: "test-token", bridgeOrigin: "http://127.0.0.1:48973" },
    requestBridgeJson: async (url, options) => {
      if (url.endsWith("/cv-fit-submissions")) { submissions.push(options.body); return { response: { ok: true }, body: { ok: true } }; }
      if (url.endsWith("/analyses/open")) { reviews.push(options.body); return { response: { ok: true }, body: { ok: true } }; }
      const match = url.match(/\/suggestions\/(.+)\/check$/);
      const body = match ? { ...batch, jobs: [{ ...jobs.find((j) => j.jobUrl.endsWith(match[1])), blockerCheck: {
        status: currentCheck, outcome: findings.length ? "blocker" : "no_blockers_found", checkedAt: new Date(now).toISOString(), findings,
      } }] } : batch;
      return { response: { ok: true }, body: { ok: true, ...body } };
    },
  });
  const send = (message, origin = sender) => new Promise((resolve) => service.handleMessage(message, origin, resolve));
  return { saved, opened, submissions, reviews, send, poll: () => send({ type: "POLL_JOB_SUGGESTION" }),
    act: (action, origin = sender) => send({ type: "ACT_ON_JOB_SUGGESTION", action, jobUrl: jobs[0].jobUrl }, origin),
    check: (value) => { currentCheck = value; },
    advance: (ms) => { now += ms; batch.collectedAt = new Date(now).toISOString(); } };
};

test("cards wait for completed or failed checks, never show checking, and include blockers", async () => {
  const finding = { requirementQuote: "Driving licence required", explanation: "No driving licence is recorded." };
  const fixture = await setup({ checkStatus: "checking", findings: [finding] });
  assert.equal((await fixture.poll()).jobs, undefined);
  assert.equal(fixture.saved["indeed-suggestion-state"], undefined);
  fixture.check("completed");
  const result = await fixture.poll();
  assert.equal(result.jobs[0].blockerCheck.findings[0].requirementQuote, finding.requirementQuote);
  assert.equal(fixture.opened.length, 0);
  for (const checkStatus of ["unavailable", "incomplete"]) {
    const failed = await setup({ checkStatus });
    assert.equal((await failed.poll()).jobs[0].blockerCheck.status, checkStatus);
  }
});

test("cards respect the persistent cooldown and deduplicate across polls", async () => {
  const fixture = await setup({ jobs: Array.from({length:6}, (_,i) => job(`fixture11${i}`)) });
  const results = await Promise.all([fixture.poll(), fixture.poll()]);
  assert.equal(results.filter((r) => r.jobs).length, 1);
  assert.equal((await fixture.poll()).jobs, undefined);
  fixture.advance(30 * 60_000);
  assert.equal((await fixture.poll()).jobs[0].jobUrl, job("fixture115").jobUrl);
});

test("local and fully remote jobs lead a multi-job stack while preserving feed order within priority", async () => {
  const jobs = [
    { ...job("fixture111"), title: "Hatfield account manager", location: "London" },
    { ...job("fixture112"), location: "Hatfield AL10" },
    { ...job("fixture113"), location: "Remote in United Kingdom" },
    { ...job("fixture114"), location: "Hybrid work in Welwyn Garden City" },
    { ...job("fixture115"), location: "Hybrid remote in Bristol" },
    { ...job("fixture116"), location: "Remote" },
  ];
  const fixture = await setup({ jobs });
  const result = await fixture.poll();
  assert.deepEqual(Array.from(result.jobs, (j) => j.jobUrl), [jobs[1], jobs[2], jobs[3], jobs[5], jobs[0]].map((j) => j.jobUrl));
  assert.equal(fixture.saved["indeed-suggestion-state"].pending.jobs.length, 5);
});

test("one priority job is enough, and acting on one job preserves the rest of its stack", async () => {
  const jobs = [job("fixture111"), { ...job("fixture112"), location: "Hatfield" }];
  const single = await setup({ jobs });
  single.saved["applied-job:indeed:fixture111"] = { appliedAt: new Date().toISOString() };
  assert.equal((await single.poll()).jobs.length, 1);
  const fixture = await setup({ jobs });
  await fixture.poll();
  assert.equal((await fixture.send({ type: "ACT_ON_JOB_SUGGESTION", action: "unsuitable", jobUrl: jobs[1].jobUrl })).ok, true);
  assert.equal(fixture.saved["unsuitable-job:indeed:fixture112"].jobUrl, jobs[1].jobUrl);
  assert.equal(fixture.saved["indeed-suggestion-state"].pending.jobs.length, 1);
  assert.equal(fixture.saved["indeed-suggestion-state"].pending.jobs[0].jobUrl, jobs[0].jobUrl);
  assert.equal((await fixture.act("dismiss")).ok, true);
  assert.equal(fixture.saved["indeed-suggestion-state"].pending, null);
});

test("card actions bind to the offered job and tab; each requires a separate explicit choice", async () => {
  for (const action of ["open", "analyse", "unsuitable", "dismiss"]) {
    const fixture = await setup();
    await fixture.poll();
    // Dismissing a stale card may close that local UI but must not consume another tab's offer.
    assert.equal((await fixture.act(action, { ...sender, tab: { id: 8 } })).ok, action === "dismiss");
    assert.equal(fixture.saved["indeed-suggestion-state"].pending.tabId, sender.tab.id);
    const answers = await Promise.all([fixture.act(action), fixture.act(action)]);
    assert.equal(answers.filter((r) => r.ok).length, 1);
    assert.equal(fixture.opened.length, action === "open" ? 1 : 0);
    assert.equal(fixture.submissions.length, action === "analyse" ? 1 : 0);
    assert.equal(Boolean(fixture.saved["unsuitable-job:indeed:fixture111"]), action === "unsuitable");
  }
});

test("signed-out, stale, disabled and marked jobs are omitted; foreign frames cannot request cards", async () => {
  for (const options of [{ status: "signed_out" }, { age: 61 * 60_000 }, {}]) {
    const fixture = await setup(options);
    if (!Object.keys(options).length) fixture.saved["indeed-recommendations-enabled"] = false;
    assert.equal((await fixture.poll()).jobs, undefined);
  }
  for (const key of ["applied-job:indeed:fixture111", "unsuitable-job:indeed:fixture111", "indeed-applied-job:fixture111", "indeed-dismissed-job:fixture111"]) {
    const fixture = await setup({ jobs: [job("fixture111")] });
    fixture.saved[key] = { recordedAt: new Date().toISOString() };
    assert.equal((await fixture.poll()).jobs, undefined);
  }
  const fixture = await setup();
  for (const origin of [{ ...sender, id: "another-extension" }, { ...sender, frameId: 1 }, { ...sender, url: "chrome://extensions" }]) {
    assert.equal((await fixture.send({ type: "POLL_JOB_SUGGESTION" }, origin)).ok, false);
  }
});

test("snooze accepts 1–5 hours, persists the deadline and prevents cards until it expires", async () => {
  for (const hours of [1, 2, 3, 4, 5]) {
    const fixture = await setup({ jobs: Array.from({length:6}, (_,i) => job(`fixture11${i}`)) });
    await fixture.poll();
    const before = Date.now();
    const result = await fixture.send({ type: "ACT_ON_JOB_SUGGESTION", action: "snooze", hours, jobUrl: job("fixture110").jobUrl });
    assert.equal(result.ok, true);
    assert.ok(fixture.saved["indeed-suggestion-state"].snoozedUntil >= before + hours * 3600_000 - 1000);
    fixture.advance(hours * 3600_000 - 1);
    assert.equal((await fixture.poll()).jobs, undefined);
    fixture.advance(1);
    assert.equal((await fixture.poll()).jobs[0].jobUrl, job("fixture115").jobUrl);
  }
  for (const hours of [0, 6, 1.5, "2"]) {
    const fixture = await setup(); await fixture.poll();
    assert.equal((await fixture.send({ type: "ACT_ON_JOB_SUGGESTION", action: "snooze", hours, jobUrl: job("fixture111").jobUrl })).ok, false);
  }
});

const saveToApply = (fixture, id, verdict = "use as-is") => {
  fixture.saved[`analyzed-job:indeed:${id}`] = {
    threadId: "11111111-1111-4111-8111-111111111111", analyzedAt: new Date().toISOString(), verdict,
  };
  fixture.saved[`job-title:indeed:${id}`] = `Saved ${id}`;
};

test("deliveries alternate between fresh jobs and saved To apply reminders, reopening existing analyses", async () => {
  const fixture = await setup({ jobs: [job("fixture111"), job("fixture112")] });
  saveToApply(fixture, "saved1111");
  const first = await fixture.poll();
  assert.equal(first.jobs[0].suggestionKind, "new");
  fixture.advance(30 * 60_000);
  const reminder = await fixture.poll();
  assert.equal(reminder.jobs[0].title, "Saved saved1111");
  assert.equal(reminder.jobs[0].suggestionKind, "toApply");
  assert.equal(reminder.jobs[0].analysisLabel, "Use as is");
  assert.equal(reminder.jobs[0].blockerCheck.status, "unavailable");
  assert.equal((await fixture.send({ type: "ACT_ON_JOB_SUGGESTION", action: "review", jobUrl: reminder.jobs[0].jobUrl })).ok, true);
  assert.equal(fixture.reviews.length, 1);
  assert.equal(fixture.submissions.length, 0);
  assert.equal(fixture.saved["indeed-suggestion-state"].nextSource, "new");
});

test("To apply reminders work without a live feed and exclude ineligible verdicts, expired and marked jobs", async () => {
  const fixture = await setup({ status: "signed_out" });
  for (const [id, verdict] of [["saved1111", "use as-is"], ["saved2222", "edit the CV"], ["saved3333", "do not apply yet"], ["saved4444", "create a new CV"], ["saved5555", "use as-is"], ["saved6666", "use as-is"]]) saveToApply(fixture, id, verdict);
  fixture.saved["applied-job:indeed:saved5555"] = { appliedAt: new Date().toISOString() };
  fixture.saved["indeed-job-availability:saved6666"] = { status: "expired" };
  const result = await fixture.poll();
  assert.deepEqual(Array.from(result.jobs, (j) => j.title).sort(), ["Saved saved1111", "Saved saved2222"]);
  fixture.advance(30 * 60_000);
  assert.equal((await fixture.poll()).jobs.length, 2, "Reminders can recur; fresh-job history must not suppress them");
});

test("saved reminders rotate beyond the first stack and snooze covers both sources", async () => {
  const fixture = await setup({ status: "unavailable" });
  for (let i = 0; i < 6; i++) saveToApply(fixture, `saved111${i}`);
  const first = await fixture.poll();
  assert.equal(first.jobs.length, 5);
  fixture.advance(30 * 60_000);
  const second = await fixture.poll();
  assert.ok(!first.jobs.some((job) => job.jobUrl === second.jobs[0].jobUrl), "An unseen reminder leads the next stack");
  assert.equal((await fixture.send({ type: "ACT_ON_JOB_SUGGESTION", action: "snooze", hours: 1, jobUrl: second.jobs[0].jobUrl })).ok, true);
  fixture.advance(30 * 60_000);
  assert.equal((await fixture.poll()).jobs, undefined);
});
