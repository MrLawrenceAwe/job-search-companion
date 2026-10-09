import assert from "node:assert/strict";
import test from "node:test";
process.env.JSC_BRIDGE_TOKEN ||= "test-token";
process.env.JSC_EXTENSION_ORIGIN ||= "chrome-extension://test";
const { createTaskDeepLink, createTaskPrompt } = await import("../../../bridge/codex/deep-link.js");

const completion = { id: "12345678-1234-1234-1234-123456789abc", token: "a".repeat(64) };

test("builds the documented new-task deep link with a workspace and unsent prompt", () => {
  const jobUrl = "https://uk.indeed.com/viewjob?jk=deep1234&from=share";
  const workspacePath = "/Users/lawrenceawe/CV Fit Advisor";
  const deepLink = new URL(createTaskDeepLink({ jobUrl, workspacePath, completion }));

  assert.equal(deepLink.protocol, "codex:");
  assert.equal(deepLink.host, "threads");
  assert.equal(deepLink.pathname, "/new");
  assert.equal(deepLink.searchParams.get("path"), workspacePath);
  assert.equal(deepLink.searchParams.get("prompt"), createTaskPrompt(jobUrl, completion));
  assert.ok(createTaskPrompt(jobUrl, completion).startsWith(`$cv-fit-advisor\n${jobUrl}`));
  assert.match(createTaskPrompt(jobUrl, completion), /complete-analysis\.js/);
  assert.match(createTaskPrompt(jobUrl, completion), /CODEX_THREAD_ID/);
});

test("encodes query-significant characters without changing the prompt", () => {
  const jobUrl = "https://uk.indeed.com/viewjob?jk=value%201&from=a+b";
  const workspacePath = "/tmp/CV Fit & Review";
  const deepLink = new URL(createTaskDeepLink({ jobUrl, workspacePath, completion }));

  assert.equal(deepLink.searchParams.get("path"), workspacePath);
  assert.equal(deepLink.searchParams.get("prompt"), createTaskPrompt(jobUrl, completion));
});
