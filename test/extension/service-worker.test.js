import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { readExtensionScript } from "../../test-support/extension-scripts.js";

const loadWorker = async (fetch) => {
  let messageHandler;
  let timeoutCallback;
  let clearedTimer;
  const sources = new Map(await Promise.all(
    ["contracts/job-urls.js", "contracts/messages.js", "bridge-config.js"].map(async (filename) =>
      [filename, await readExtensionScript(filename)]),
  ));
  const context = vm.createContext({
    AbortController,
    AbortSignal,
    URL,
    clearTimeout: (timer) => { clearedTimer = timer; },
    chrome: {
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
    type: "GET_CV_FIT_TASK_STATUS",
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
  const worker = await loadWorker(async () => ({ json: async () => ({ ok: true, connectionStatus: { planUsageEnabled: true, email: "private@example.test", activeId: "private" }, profile: { hash: "hash", sources: [{ path: "/private/profile.md" }] } }) }));
  const result = await new Promise((resolve) => worker.messageHandler({ type: "BLOCKER_REQUEST", action: "status" }, { url: "https://uk.indeed.com/jobs" }, resolve));
  assert.equal(JSON.stringify(result.connectionStatus), JSON.stringify({ planUsageEnabled: true }));
  assert.equal(JSON.stringify(result.profile), JSON.stringify({ hash: "hash" }));
});

test("settings may initiate sign-in and receive its authorization URL", async () => {
  const worker = await loadWorker(async () => ({ json: async () => ({ ok: true, authUrl: "https://auth.openai.com/authorize" }) }));
  const result = await new Promise((resolve) => worker.messageHandler({ type: "BLOCKER_REQUEST", action: "sign-in", body: { newAccount: true } }, { url: "chrome-extension://test/options.html" }, resolve));
  assert.equal(result.authUrl, "https://auth.openai.com/authorize");
});
