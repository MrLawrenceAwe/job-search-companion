import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { readExtensionScript } from "../../test-support/extension-scripts.js";

const loadWorker = async (fetch) => {
  const storage = {};
  let messageHandler;
  let timeoutCallback;
  let clearedTimer;
  const sources = new Map(await Promise.all(
    ["contracts/job-urls.js", "contracts/identifiers.js", "contracts/job-analyses.js", "contracts/messages.js", "bridge-config.js"].map(async (filename) =>
      [filename, await readExtensionScript(filename)]),
  ));
  const context = vm.createContext({
    AbortController,
    AbortSignal,
    URL,
    clearTimeout: (timer) => { clearedTimer = timer; },
    chrome: {
      storage: { local: { get: async () => ({ ...storage }), set: async (values) => Object.assign(storage, values) } },
      runtime: {
        getURL: (path) => `chrome-extension://test/${path}`,
        onMessage: {
          addListener: (handler) => { messageHandler = handler; },
        },
      },
    },
    fetch,
    importScripts: (...filenames) => {
      for (const filename of filenames) {
        if (filename === "local-config.js") {
          Object.assign(context.jobSearchBridgeConfig, {
            bridgeToken: "test-token",
            bridgeOrigin: "http://127.0.0.1:48973",
          });
        } else {
          assert.ok(sources.has(filename), `Unexpected worker dependency: ${filename}`);
          vm.runInContext(sources.get(filename), context, { filename });
        }
      }
    },
    setTimeout: (callback) => {
      timeoutCallback = callback;
      return 17;
    },
  });
  const source = await readFile(new URL("../../extension/service-worker.js", import.meta.url), "utf8");
  vm.runInContext(source, context, { filename: "service-worker.js" });
  const request = (message) => new Promise((resolve) => {
    assert.equal(messageHandler(message, {}, resolve), true);
  });
  return {
    get clearedTimer() { return clearedTimer; },
    get timeoutCallback() { return timeoutCallback; },
    request,
    messageHandler,
    storage,
  };
};

test("service worker starts a bridge submission", async () => {
  let captured;
  const worker = await loadWorker(async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 202,
      json: async () => ({ ok: true, submission: { id: "submission-1", status: "submitting" } }),
    };
  });

  const response = await worker.request({
    type: "SUBMIT_CV_FIT_TASK",
    jobUrl: "https://uk.indeed.com/viewjob?jk=success111",
  });

  assert.equal(captured.url, "http://127.0.0.1:48973/cv-fit-submissions");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.cache, "no-store");
  assert.deepEqual(
    JSON.parse(captured.options.body),
    { jobUrl: "https://uk.indeed.com/viewjob?jk=success111" },
  );
  assert.equal(JSON.stringify(response), JSON.stringify({
    ok: true,
    submission: { id: "submission-1", status: "submitting" },
  }));
  assert.equal(worker.clearedTimer, 17);
});

test("service worker aborts an unresponsive bridge request", async () => {
  let signal;
  const worker = await loadWorker((_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  });
  const response = worker.request({
    type: "SUBMIT_CV_FIT_TASK",
    jobUrl: "https://uk.indeed.com/viewjob?jk=timeout111",
  });
  worker.timeoutCallback();

  assert.equal(signal.aborted, true);
  assert.equal(JSON.stringify(await response), JSON.stringify({
    ok: false,
    error: "The local bridge did not respond within 10 seconds",
  }));
});

test("service worker requests a correlated submission status", async () => {
  let captured;
  const worker = await loadWorker(async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, submission: { id: "submission-1", status: "submitted" } }),
    };
  });

  const response = await worker.request({
    type: "GET_CV_FIT_SUBMISSION_STATUS",
    submissionId: "submission-1",
  });

  assert.equal(captured.url, "http://127.0.0.1:48973/cv-fit-submissions/submission-1");
  assert.equal(captured.options.method, "GET");
  assert.equal(captured.options.cache, "no-store");
  assert.equal(JSON.stringify(response), JSON.stringify({
    ok: true,
    submission: { id: "submission-1", status: "submitted" },
  }));
});

test("service worker forwards bridge errors", async () => {
  const worker = await loadWorker(async () => ({
    ok: false,
    status: 409,
    json: async () => ({ ok: false, error: "A task is already being submitted" }),
  }));

  assert.equal(JSON.stringify(await worker.request({
    type: "SUBMIT_CV_FIT_TASK",
    jobUrl: "https://uk.indeed.com/viewjob?jk=busyjob111",
  })), JSON.stringify({
    ok: false,
    error: "A task is already being submitted",
  }));
});

test("blocker transport aborts a stalled request and keeps its checker error message", async () => {
  const worker = await loadWorker((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  }));
  const response = new Promise((resolve) => worker.messageHandler(
    { type: "BLOCKER_REQUEST", action: "status" },
    { url: "https://uk.indeed.com/jobs" },
    resolve,
  ));
  worker.timeoutCallback();
  assert.equal((await response).error, "Local checker did not respond. Try again.");
  assert.equal(worker.clearedTimer, 17);
});

test("malformed bridge JSON retains each feature's failure response", async () => {
  const worker = await loadWorker(async () => ({
    ok: false,
    status: 502,
    json: async () => { throw new SyntaxError("Invalid JSON"); },
  }));
  const submission = await worker.request({
    type: "SUBMIT_CV_FIT_TASK",
    jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111",
  });
  assert.equal(submission.error, "Request failed with status 502");
  const check = await new Promise((resolve) => worker.messageHandler(
    { type: "BLOCKER_REQUEST", action: "status" },
    { url: "https://uk.indeed.com/jobs" },
    resolve,
  ));
  assert.equal(check.error, "Local checker unavailable. Check that the bridge is running.");
});


test("blocker requests reject LinkedIn and keep account controls confined to settings", async () => {
  let requests = 0;
  const worker = await loadWorker(async () => { requests++; return { json: async () => ({ ok: true }) }; });
  for (const [action, sender] of [["check", { url: "https://www.linkedin.com/jobs/view/123456789/" }], ["sign-in", { url: "https://uk.indeed.com/jobs" }], ["status", { url: "https://indeed.com.attacker.test/jobs" }]]) {
    let result;
    assert.equal(worker.messageHandler({ type: "BLOCKER_REQUEST", action }, sender, (value) => { result = value; }), false);
    assert.equal(result.ok, false);
  }
  assert.equal(requests, 0);
});

test("Indeed status responses omit account identity and local profile paths", async () => {
  const worker = await loadWorker(async () => ({ json: async () => ({ ok: true, connectionStatus: { planUsageEnabled: true, email: "private@example.test", activeId: "private" }, evidence: { hash: "hash", sources: [{ path: "/private/profile.md" }] } }) }));
  const result = await new Promise((resolve) => worker.messageHandler({ type: "BLOCKER_REQUEST", action: "status" }, { url: "https://uk.indeed.com/jobs" }, resolve));
  assert.equal(JSON.stringify(result.connectionStatus), JSON.stringify({ planUsageEnabled: true }));
  assert.equal(JSON.stringify(result.evidence), JSON.stringify({ hash: "hash" }));
});

test("settings may initiate sign-in and receive its authorization URL", async () => {
  const worker = await loadWorker(async () => ({ json: async () => ({ ok: true, authUrl: "https://auth.openai.com/authorize" }) }));
  const result = await new Promise((resolve) => worker.messageHandler({ type: "BLOCKER_REQUEST", action: "sign-in", body: { newAccount: true } }, { url: "chrome-extension://test/options.html" }, resolve));
  assert.equal(result.authUrl, "https://auth.openai.com/authorize");
});

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


test("blocker polling validates UUID structure before contacting the bridge", async () => {
  const id = "ABCDEF12-1234-1234-1234-123456789ABC";
  let captured;
  const worker = await loadWorker(async (url) => {
    captured = url;
    return { json: async () => ({ ok: true, check: { id, status: "completed" } }) };
  });
  const sender = { url: "https://uk.indeed.com/jobs" };
  let rejected;
  assert.equal(worker.messageHandler(
    { type: "BLOCKER_REQUEST", action: "poll", id: "-".repeat(36) }, sender,
    (reply) => { rejected = reply; },
  ), false);
  assert.equal(rejected.error, "Invalid check ID");
  assert.equal(captured, undefined);
  const reply = await new Promise((resolve) => worker.messageHandler(
    { type: "BLOCKER_REQUEST", action: "poll", id }, sender, resolve,
  ));
  assert.equal(reply.check.id, id);
  assert.equal(captured, `http://127.0.0.1:48973/blockers/checks/${id}`);
});

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
