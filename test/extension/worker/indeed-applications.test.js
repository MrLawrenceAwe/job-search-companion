import assert from "node:assert/strict";
import test from "node:test";
import { loadWorker } from "../../../test-support/worker-fixture.js";

const requestIndeedSync = (worker, sender = { url: 'https://uk.indeed.com/' }) => new Promise((resolve) => {
  worker.messageHandler({ type: 'SYNC_INDEED_APPLICATIONS' }, sender, resolve);
});
const historyJob = (id, status, userStatus = 'POST_APPLY') => ({
  jobKey: id, jobTitle: `Title ${id}`, statuses: {
    userJobStatus: { status: userStatus }, candidateStatus: { status },
  },
});
const analysedJob = { threadId: '01a11fef-d2cd-7410-953a-37e6497346d8', analyzedAt: '2026-10-19T09:00:00Z', verdict: 'use as-is' };

test('Indeed history sync includes submitted and archived applications but excludes drafts and unfinished attempts', async () => {
  const calls = [];
  const worker = await loadWorker(async (url, options) => {
    calls.push({ url, options });
    const jobs = url.includes('type=ARCHIVED') ? [historyJob('archived11', 'REJECTED', 'ARCHIVED')] : [
      historyJob('submitted1', 'APPLIED'), historyJob('draftjob11', 'APPLY_IN_PROGRESS'),
      historyJob('maybejob11', 'MAYBE_APPLIED'), historyJob('pending111', 'NEXUS_PENDING'),
      historyJob('otherjob11', 'APPLIED'),
    ];
    return { ok: true, json: async () => ({ success: true, body: { appStatusJobs: jobs } }) };
  });
  for (const id of ['submitted1', 'archived11', 'draftjob11', 'maybejob11', 'pending111']) {
    worker.storage[`analyzed-job:indeed:${id}`] = analysedJob;
  }
  assert.equal((await requestIndeedSync(worker)).ok, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ url, options }) => url.startsWith('https://myjobs.indeed.com/api/v1/appStatusJobs?') && options.credentials === 'include'));
  for (const id of ['submitted1', 'archived11']) assert.ok(worker.storage[`indeed-applied-job:${id}`]);
  for (const id of ['draftjob11', 'maybejob11', 'pending111', 'otherjob11']) assert.equal(worker.storage[`indeed-applied-job:${id}`], undefined);
  assert.equal(worker.storage['job-title:indeed:submitted1'], 'Title submitted1');
  await requestIndeedSync(worker);
  assert.equal(calls.length, 2, 'multiple tabs share the short refresh cooldown');
});

test('Indeed application sync requires an Indeed sender', async () => {
  const worker = await loadWorker(() => { throw new Error('Must not fetch'); });
  for (const url of ['https://www.linkedin.com/jobs/', 'https://example.com/', 'http://uk.indeed.com/']) {
    assert.equal((await requestIndeedSync(worker, { url })).ok, false);
  }
});

for (const response of [
  { ok: false, json: async () => ({}) },
  { ok: true, json: async () => ({ success: false }) },
  { ok: true, json: async () => ({ success: true, body: {} }) },
]) {
  test('unavailable or malformed Indeed history preserves saved application detections', async () => {
    const worker = await loadWorker(async () => response);
    worker.storage['indeed-applied-job:submitted1'] = { detectedAt: '2026-10-19' };
    assert.equal((await requestIndeedSync(worker)).ok, false);
    assert.ok(worker.storage['indeed-applied-job:submitted1']);
  });
}

test('a self-reported Indeed application is counted, while saved-only archived jobs are not', async () => {
  const worker = await loadWorker(async () => ({ ok: true, json: async () => ({ success: true, body: { appStatusJobs: [
    { jobKey: 'manual1111', statuses: { selfReportedStatus: { status: 'APPLIED' } } },
    historyJob('savedjob11', 'NOT_INTERESTED', 'ARCHIVED'),
  ] } }) }));
  for (const id of ['manual1111', 'savedjob11']) worker.storage[`analyzed-job:indeed:${id}`] = analysedJob;
  assert.equal((await requestIndeedSync(worker)).ok, true);
  assert.ok(worker.storage['indeed-applied-job:manual1111']);
  assert.equal(worker.storage['indeed-applied-job:savedjob11'], undefined);
});
