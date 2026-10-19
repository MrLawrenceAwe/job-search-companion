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
