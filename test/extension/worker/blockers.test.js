import assert from "node:assert/strict";
import test from "node:test";
import { loadWorker } from "../../../test-support/worker-fixture.js";

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
