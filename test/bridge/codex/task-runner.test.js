import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
process.env.JSC_BRIDGE_TOKEN ||= "test-token";
process.env.JSC_EXTENSION_ORIGIN ||= "chrome-extension://test";
const { accessibilityHelperTimeoutMs, createAccessibilityHelperArguments } =
  await import("../../../bridge/codex/task-runner.js");

test("requests auto-submit only when Sol, Medium, and Fast are already selected", () => {
  const jobUrl = "https://uk.indeed.com/viewjob?jk=configured1";
  const completion = { id: "12345678-1234-1234-1234-123456789abc", token: "a".repeat(64) };
  const args = createAccessibilityHelperArguments({ jobUrl, completion });
  const command = JSON.parse(args[1]);

  assert.equal(args[0], "auto-submit-if-configured");
  assert.equal(args.length, 2);
  assert.equal(command.jobUrl, jobUrl);
  assert.ok(new URL(command.newTaskUrl).searchParams.get("prompt").startsWith(`$cv-fit-advisor\n${jobUrl}`));
  assert.ok(new URL(command.newTaskUrl).searchParams.get("prompt").includes(completion.token));
  assert.equal(command.bundleIdentifier, "com.openai.codex");
  assert.deepEqual(command.settings.map(({ category, expectedValue, match }) => ({
    category,
    expectedValue,
    match,
  })), [
    { category: "Model", expectedValue: "6.1 Sol", match: "exact" },
    { category: "Effort", expectedValue: "Medium", match: "exact" },
    { category: "Speed", expectedValue: "Fast", match: "prefix" },
  ]);
});

test("task submissions use the precompiled Accessibility helper", async () => {
  const source = await readFile(new URL("../../../bridge/codex/task-runner.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /\/usr\/bin\/swift/);
  assert.doesNotMatch(source, /openTaskDraft/);
  assert.doesNotMatch(source, /\["contract-self-test"\]/);
  assert.match(source, /config\.codex\.accessibilityHelperPath/);
});

test("bridge requests stay shorter than the Accessibility operation", async () => {
  const serviceWorkerSource = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../../../extension/service-worker.js", import.meta.url), "utf8"));
  const bridgeRequestTimeout = Number(
    serviceWorkerSource.match(/const REQUEST_TIMEOUT_MS = ([\d_]+);/)?.[1].replaceAll("_", ""),
  );

  assert.equal(accessibilityHelperTimeoutMs, 61_000);
  assert.ok(bridgeRequestTimeout < accessibilityHelperTimeoutMs);
});
