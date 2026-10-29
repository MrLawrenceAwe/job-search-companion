import assert from "node:assert/strict";
import test from "node:test";
import { loadWorker } from "../../../test-support/worker-fixture.js";

test("analysis sync stores only completed records and shares one in-flight fetch", async () => {
  const record = { jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111", threadId: "01a11fef-d2cd-7410-953a-37e6497346d8", analyzedAt: "2026-10-09T09:00:00.000Z" };
  let captured;
  let release;
  const worker = await loadWorker(async (url) => {
    captured = url;
    await new Promise((r) => { release = r; });
    return { ok: true, json: async () => ({ ok: true, analyses: [record] }) };
  });
  const sender = { url: "https://uk.indeed.com/jobs" };
  const first = new Promise((r) => worker.messageHandler({ type: "SYNC_JOB_ANALYSES" }, sender, r));
  const second = new Promise((r) => worker.messageHandler({ type: "SYNC_JOB_ANALYSES" }, sender, r));
  release();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(captured, "http://127.0.0.1:48973/analyses");
  assert.equal(JSON.stringify(worker.storage["analyzed-job:indeed:fixture111"]), JSON.stringify(record));
});

test("analysis actions reject foreign senders and open through the authenticated local bridge", async () => {
  let captured;
  const worker = await loadWorker(async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ ok: true }) };
  });
  let rejected;
  worker.messageHandler({ type: "OPEN_JOB_ANALYSIS", jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111" }, { url: "https://indeed.com.attacker.test" }, (r) => { rejected = r; });
  assert.equal(rejected.ok, false);
  assert.equal(captured, undefined);
  const response = await new Promise((r) => worker.messageHandler({ type: "OPEN_JOB_ANALYSIS", jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111" }, { url: "https://uk.indeed.com/jobs" }, r));
  assert.equal(response.ok, true);
  assert.equal(captured.url, "http://127.0.0.1:48973/analyses/open");
  assert.equal(captured.options.headers["X-JSC-Token"], "test-token");
});

test("Do not apply yet automatically marks unsuitable once per assessment without replacing manual marks", async () => {
  const base = { threadId: "01a11fef-d2cd-7410-953a-37e6497346d8", analyzedAt: "2026-10-29T09:00:00.000Z" };
  let records = [
    { ...base, jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111", verdict: "do not apply yet" },
    { ...base, jobUrl: "https://uk.indeed.com/viewjob?jk=fixture222", verdict: "use as-is" },
    { ...base, jobUrl: "https://www.linkedin.com/jobs/view/12345678/", verdict: "do not apply yet" },
  ];
  const worker = await loadWorker(async () => ({ ok: true, json: async () => ({ ok: true, analyses: records }) }));
  const manual = { jobUrl: records[2].jobUrl, unsuitableAt: "2026-10-28T09:00:00.000Z" };
  worker.storage["unsuitable-job:linkedin:12345678"] = manual;
  const sync = () => new Promise((r) => worker.messageHandler({ type: "SYNC_JOB_ANALYSES" }, { url: "https://uk.indeed.com/jobs" }, r));
  assert.equal((await sync()).ok, true);
  assert.equal(worker.storage["unsuitable-job:indeed:fixture111"].jobUrl, records[0].jobUrl);
  assert.ok(Number.isFinite(Date.parse(worker.storage["unsuitable-job:indeed:fixture111"].unsuitableAt)));
  assert.equal(worker.storage["unsuitable-job:indeed:fixture222"], undefined);
  assert.equal(worker.storage["unsuitable-job:linkedin:12345678"], manual);
  delete worker.storage["unsuitable-job:indeed:fixture111"];
  await sync();
  assert.equal(worker.storage["unsuitable-job:indeed:fixture111"], undefined, "Repeated sync respects manual clearing");
  records = [{ ...records[0], analyzedAt: "2026-10-29T10:00:00.000Z" }];
  await sync();
  assert.ok(worker.storage["unsuitable-job:indeed:fixture111"], "A new assessment can mark it again");
  records = [{ ...records[0], verdict: "use as-is", analyzedAt: "2026-10-29T11:00:00.000Z" }];
  await sync();
  assert.ok(worker.storage["unsuitable-job:indeed:fixture111"], "A later assessment does not silently erase a saved mark");
});
