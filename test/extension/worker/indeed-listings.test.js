import assert from "node:assert/strict";
import test from "node:test";
import { loadWorker } from "../../../test-support/worker-fixture.js";

const analysedJob = { threadId: '01a11fef-d2cd-7410-953a-37e6497346d8', analyzedAt: '2026-10-19T09:00:00Z', verdict: 'use as-is' };

const requestJobTitle = (worker, jobId = 'fixture111', sender = { url: 'https://uk.indeed.com/' }) => new Promise((resolve) => {
  worker.messageHandler({ type: 'GET_INDEED_JOB_TITLE', jobId }, sender, resolve);
});
const titleResponse = (html, id = 'fixture111') => ({
  ok: true, url: `https://uk.indeed.com/viewjob?jk=${id}`, text: async () => html,
});

const requestAvailability = (worker, jobId = 'fixture111', sender = { url: 'https://uk.indeed.com/' }) => new Promise((resolve) => {
  worker.messageHandler({ type: 'GET_INDEED_JOB_AVAILABILITY', jobId }, sender, resolve);
});

test('availability checks detect the expired notice even when a job title is cached, and deduplicate across tabs', async () => {
  let fetches = 0;
  const worker = await loadWorker(async () => {
    fetches++;
    return titleResponse('<title>Stores Co-ordinator - Hatfield - Indeed.com</title><div id="alert-content"><h3>This job has expired on Indeed</h3></div>');
  });
  worker.storage['analyzed-job:indeed:fixture111'] = analysedJob;
  worker.storage['job-title:indeed:fixture111'] = 'Stores Co-ordinator';
  const results = await Promise.all([requestAvailability(worker), requestAvailability(worker)]);
  assert.ok(results.every(result => result.availability.status === 'expired'));
  assert.equal(fetches, 1);
  assert.equal((await requestAvailability(worker)).availability.status, 'expired');
  assert.equal(fetches, 1);
});

for (const html of [
  '<title>Just a moment</title>',
  '<title>Job - City - Indeed.com</title><p>This job has expired on Indeed</p>',
  '<script>const example = "<h3>This job has expired on Indeed</h3>";</script>',
]) {
  test('unconfirmed availability keeps a previous expired status without marking errors as expiry', async () => {
    const worker = await loadWorker(async () => titleResponse(html));
    worker.storage['analyzed-job:indeed:fixture111'] = analysedJob;
    const previous = { status: 'expired', checkedAt: '2000-01-01T00:00:00Z' };
    worker.storage['indeed-job-availability:fixture111'] = previous;
    assert.equal((await requestAvailability(worker)).ok, false);
    assert.equal(worker.storage['indeed-job-availability:fixture111'], previous);
  });
}

test('availability follows JobPosting expiry dates and can confirm a reopened listing', async () => {
  let validThrough = '2000-01-01T00:00:00Z';
  const worker = await loadWorker(async () => titleResponse(`<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'JobPosting', title: 'Advisor', validThrough }] })}</script>`));
  worker.storage['analyzed-job:indeed:fixture111'] = analysedJob;
  assert.equal((await requestAvailability(worker)).availability.status, 'expired');
  worker.storage['indeed-job-availability:fixture111'].checkedAt = '2000-01-01T00:00:00Z';
  validThrough = '2999-01-01T00:00:00Z';
  assert.equal((await requestAvailability(worker)).availability.status, 'active');
});

test('availability checks require an analysed Indeed job and reject redirects and HTTP errors', async () => {
  let fetches = 0;
  const worker = await loadWorker(async () => { fetches++; return { ...titleResponse('<h3>This job has expired on Indeed</h3>'), ok: false }; });
  assert.equal((await requestAvailability(worker)).ok, false);
  assert.equal(fetches, 0);
  worker.storage['analyzed-job:indeed:fixture111'] = analysedJob;
  assert.equal((await requestAvailability(worker, '../bad')).ok, false);
  assert.equal((await requestAvailability(worker, 'fixture111', { url: 'https://example.com/' })).ok, false);
  assert.equal(fetches, 0);
  assert.equal((await requestAvailability(worker)).ok, false);
  assert.equal(worker.storage['indeed-job-availability:fixture111'], undefined);
  const redirected = await loadWorker(async () => titleResponse('<h3>This job has expired on Indeed</h3>', 'another111'));
  redirected.storage['analyzed-job:indeed:fixture111'] = analysedJob;
  assert.equal((await requestAvailability(redirected)).ok, false);
  assert.equal(redirected.storage['indeed-job-availability:fixture111'], undefined);
});

test('missing titles are fetched from JobPosting data, cached, and reused across tabs', async () => {
  let fetches = 0;
  const worker = await loadWorker(async (url) => {
    fetches++;
    assert.equal(url, 'https://uk.indeed.com/viewjob?jk=fixture111');
    return titleResponse(`<title>Unrelated page heading</title><script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting', title: '  Customer Service & Operations\nAdvisor ',
    })}</script>`);
  });
  worker.storage['analyzed-job:indeed:fixture111'] = analysedJob;
  const results = await Promise.all([requestJobTitle(worker), requestJobTitle(worker)]);
  assert.ok(results.every((result) => result.title === 'Customer Service & Operations Advisor'));
  assert.equal(fetches, 1);
  assert.equal(worker.storage['job-title:indeed:fixture111'], 'Customer Service & Operations Advisor');
  await requestJobTitle(worker);
  assert.equal(fetches, 1);
});

test('job-title extraction accepts JSON-LD graphs and ignores other schema titles and malformed scripts', async () => {
  const worker = await loadWorker(async () => titleResponse(`<script type="application/ld+json">broken</script>
    <script nonce="test" type='application/ld+json'>${JSON.stringify([{ '@type': 'WebSite', title: 'Indeed' }, {
      '@graph': [{ '@type': ['Thing', 'JobPosting'], title: 'Warehouse Associate' }],
    }])}</script>`));
  worker.storage['analyzed-job:indeed:fixture111'] = analysedJob;
  assert.equal((await requestJobTitle(worker)).title, 'Warehouse Associate');
});

for (const response of [
  { ok: false },
  titleResponse('<title>Just a moment</title>'),
  titleResponse('<script type="application/ld+json">{"@type":"JobPosting","title":"Other job"}</script>', 'another111'),
]) {
  test('unavailable listings and unexpected redirects never replace job titles with error-page text', async () => {
    const worker = await loadWorker(async () => response);
    worker.storage['analyzed-job:indeed:fixture111'] = analysedJob;
    assert.equal((await requestJobTitle(worker)).ok, false);
    assert.equal(worker.storage['job-title:indeed:fixture111'], undefined);
  });
}

test('job title fetching rejects unrelated senders, malformed IDs, and jobs without an analysis', async () => {
  const worker = await loadWorker(() => { throw new Error('Must not fetch'); });
  assert.equal((await requestJobTitle(worker, 'fixture111', { url: 'https://www.linkedin.com/' })).ok, false);
  assert.equal((await requestJobTitle(worker, '../cookies')).ok, false);
  assert.equal((await requestJobTitle(worker)).ok, false);
});

test('listings without JobPosting data use the job/location page title and decode text entities', async () => {
  const worker = await loadWorker(async () => titleResponse('<title>Stores Co-ordinator &amp; Stock &#x26; Logistics - Hatfield AL9 5JN - Indeed.com</title>'));
  worker.storage['analyzed-job:indeed:fixture111'] = analysedJob;
  assert.equal((await requestJobTitle(worker)).title, 'Stores Co-ordinator & Stock & Logistics');
});

test("concurrent title and availability requests share a listing read", async () => {
  let fetches = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const worker = await loadWorker(async () => {
    fetches += 1;
    await pending;
    return titleResponse('<script type="application/ld+json">{"@type":"JobPosting","title":"Support Advisor","validThrough":"2999-01-01T00:00:00Z"}</script>');
  });
  worker.storage['analyzed-job:indeed:fixture111'] = analysedJob;
  const title = requestJobTitle(worker);
  const availability = requestAvailability(worker);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1);
  release();
  assert.equal((await title).title, "Support Advisor");
  assert.equal((await availability).availability.status, "active");
});

test('listing refreshes bound concurrency across jobs and release slots after failures', async () => {
  let active = 0;
  let peak = 0;
  const started = [];
  const releases = [];
  const worker = await loadWorker(async (url) => {
    active++;
    peak = Math.max(peak, active);
    const id = new URL(url).searchParams.get('jk');
    started.push(id);
    await new Promise((resolve) => releases.push(resolve));
    active--;
    return { ...titleResponse('<script type="application/ld+json">{"@type":"JobPosting","title":"Advisor","validThrough":"2999-01-01T00:00:00Z"}</script>', id), ok: id !== 'fixture000' };
  });
  const requests = Array.from({ length: 8 }, (_, index) => {
    const id = `fixture00${index}`;
    worker.storage[`analyzed-job:indeed:${id}`] = analysedJob;
    return requestAvailability(worker, id);
  });
  const duplicate = requestJobTitle(worker, 'fixture007');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 3, 'only three jobs should start before a slot is released');
  for (let index = 0; index < requests.length; index++) {
    releases[index]();
    await new Promise((resolve) => setImmediate(resolve));
  }
  const results = await Promise.all(requests);
  assert.equal(results[0].ok, false);
  assert.ok(results.slice(1).every((result) => result.ok));
  assert.equal((await duplicate).title, 'Advisor');
  assert.equal(started.length, 8, 'queued title and availability requests share one listing');
  assert.equal(peak, 3);
});
