import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

process.env.JSC_BRIDGE_TOKEN ||= "test-token";
process.env.JSC_EXTENSION_ORIGIN ||= "chrome-extension://test";

const { readJsonBody, RequestBodyTooLargeError } = await import("../../bridge/http-helpers.js");
const { createRequestHandler } = await import("../../bridge/request-handler.js");

const invokeHandler = async (handler, { method, url, body }) => {
  const request = new PassThrough();
  Object.assign(request, {
    headers: {
      origin: "chrome-extension://test",
      "x-jsc-token": "test-token",
    },
    method,
    url,
  });
  const response = {
    body: null,
    headers: null,
    statusCode: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(responseBody) { this.body = responseBody; },
  };
  const handled = handler(request, response);
  request.end(body === undefined ? undefined : JSON.stringify(body));
  await handled;
  return {
    body: JSON.parse(response.body),
    headers: response.headers,
    statusCode: response.statusCode,
  };
};

const createHandler = (overrides = {}) => createRequestHandler({
  bridgeConfig: {
    allowedExtensionOrigin: "chrome-extension://test",
    name: "bridge",
    port: 48973,
    instanceId: "test-instance-id",
    token: "test-token",
    version: "test",
  },
  cvFitConfig: {
    settings: [{ category: "Model", label: "6.1 Sol" }],
    workspacePath: "/workspace",
  },
  logger: { info() {}, warn() {}, error() {} },
  readHelperHealth: async () => ({ ready: true }),
  submitTask: async () => ({ status: "submitted" }),
  submissionStore: { submissions: new Map(), save: async () => {} },
  createSubmissionId: () => "submission-1",
  ...overrides,
});

test("oversized JSON bodies are rejected without destroying the request", async () => {
  const request = new PassThrough();
  const result = readJsonBody(request);
  request.end(JSON.stringify({ jobUrl: "x".repeat(20_001) }));

  await assert.rejects(result, RequestBodyTooLargeError);
  assert.equal(request.destroyed, false);
});

test("request handler exposes health", async () => {
  const response = await invokeHandler(createHandler(), { method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(response.body.workspace, "/workspace");
  assert.equal(response.body.instanceId, "test-instance-id");
  assert.deepEqual(response.body.requiredSettings, [{ category: "Model", label: "6.1 Sol" }]);
});

test("request handler normalizes and completes a submission", async () => {
  let submittedJobUrl;
  const handler = createHandler({
    submitTask: async ({ jobUrl }) => {
      submittedJobUrl = jobUrl;
      return { status: "submitted" };
    },
  });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/cv-fit-submissions",
    body: { jobUrl: "https://uk.indeed.com/viewjob?vjk=fixture111" },
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.ok, true);
  assert.deepEqual(response.body.submission, { id: "submission-1", status: "submitting" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(submittedJobUrl, "https://uk.indeed.com/viewjob?jk=fixture111");

  const status = await invokeHandler(handler, {
    method: "GET",
    url: "/cv-fit-submissions/submission-1",
  });
  assert.equal(status.body.submission.status, "submitted");
});

test("request handler accepts and normalizes LinkedIn job URLs", async () => {
  let submittedJobUrl;
  const handler = createHandler({
    submitTask: async ({ jobUrl }) => {
      submittedJobUrl = jobUrl;
      return { status: "submitted" };
    },
  });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/cv-fit-submissions",
    body: {
      jobUrl: "https://www.linkedin.com/jobs/view/4447780789/?trackingId=ignored",
    },
  });

  assert.equal(response.statusCode, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(submittedJobUrl, "https://www.linkedin.com/jobs/view/4447780789/");
});

test("request handler rejects non-job LinkedIn URLs", async () => {
  const response = await invokeHandler(createHandler(), {
    method: "POST",
    url: "/cv-fit-submissions",
    body: { jobUrl: "https://www.linkedin.com/feed/" },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "Only Indeed and LinkedIn job URLs are allowed");
});

test("request handler reports helper failures", async () => {
  const handler = createHandler({
    submitTask: async () => { throw new Error("Codex UI changed"); },
  });
  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/cv-fit-submissions",
    body: { jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111" },
  });

  assert.equal(response.statusCode, 202);
  await new Promise((resolve) => setImmediate(resolve));
  const status = await invokeHandler(handler, {
    method: "GET",
    url: "/cv-fit-submissions/submission-1",
  });
  assert.equal(status.body.submission.status, "failed");
  assert.equal(status.body.submission.error, "Codex UI changed");
});

test("request handler reports a prepared draft when settings do not match", async () => {
  const handler = createHandler({
    submitTask: async () => ({ status: "ready_for_review" }),
  });
  await invokeHandler(handler, {
    method: "POST",
    url: "/cv-fit-submissions",
    body: { jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111" },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const status = await invokeHandler(handler, {
    method: "GET",
    url: "/cv-fit-submissions/submission-1",
  });
  assert.equal(status.body.submission.status, "ready_for_review");
});

test("request handler admits only one active submission", async () => {
  let releaseSubmission;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const handler = createHandler({
    submitTask: async () => {
      markStarted();
      await new Promise((resolve) => { releaseSubmission = resolve; });
      return { status: "submitted" };
    },
  });
  const firstRequest = invokeHandler(handler, {
    method: "POST",
    url: "/cv-fit-submissions",
    body: { jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111" },
  });
  await started;

  const secondResponse = await invokeHandler(handler, {
    method: "POST",
    url: "/cv-fit-submissions",
    body: { jobUrl: "https://uk.indeed.com/viewjob?jk=fixture222" },
  });

  assert.equal(secondResponse.statusCode, 409);
  releaseSubmission();
  await firstRequest;
});

test("completed submission statuses remain correlated after a later task starts", async () => {
  let nextId = 1;
  const handler = createHandler({
    createSubmissionId: () => `submission-${nextId++}`,
    submitTask: async ({ jobUrl }) => {
      if (jobUrl.includes("fixture222")) {
        throw new Error("second task failed");
      }
      return { status: "submitted" };
    },
  });

  await invokeHandler(handler, {
    method: "POST",
    url: "/cv-fit-submissions",
    body: { jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await invokeHandler(handler, {
    method: "POST",
    url: "/cv-fit-submissions",
    body: { jobUrl: "https://uk.indeed.com/viewjob?jk=fixture222" },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const firstStatus = await invokeHandler(handler, {
    method: "GET",
    url: "/cv-fit-submissions/submission-1",
  });
  const secondStatus = await invokeHandler(handler, {
    method: "GET",
    url: "/cv-fit-submissions/submission-2",
  });
  assert.equal(firstStatus.body.submission.status, "submitted");
  assert.equal(secondStatus.body.submission.status, "failed");
  assert.equal(secondStatus.body.submission.error, "second task failed");
});

test("request handler saves pending and completed statuses", async () => {
  const submissions = new Map();
  const savedStatuses = [];
  const handler = createHandler({
    submissionStore: {
      submissions,
      async save() {
        savedStatuses.push(submissions.get("submission-1")?.status);
      },
    },
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/cv-fit-submissions",
    body: { jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111" },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(response.statusCode, 202);
  assert.deepEqual(savedStatuses, ["submitting", "submitted"]);
});

test("request handler does not start a task if pending status cannot be saved", async () => {
  let started = false;
  const handler = createHandler({
    submissionStore: {
      submissions: new Map(),
      save: async () => { throw new Error("disk unavailable"); },
    },
    submitTask: async () => {
      started = true;
      return { status: "submitted" };
    },
  });

  const response = await invokeHandler(handler, {
    method: "POST",
    url: "/cv-fit-submissions",
    body: { jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111" },
  });

  assert.equal(response.statusCode, 503);
  assert.equal(started, false);
});
