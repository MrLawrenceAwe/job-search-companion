import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

process.env.JSC_BRIDGE_TOKEN ||= "test-token";
process.env.JSC_EXTENSION_ORIGIN ||= "chrome-extension://test";

const {
  createTaskDeepLink,
  createTaskPrompt,
} = await import("../bridge/codex/deep-link.js");
const {
  accessibilityHelperTimeoutMs,
  createAccessibilityHelperArguments,
} = await import("../bridge/codex/task-runner.js");

test("builds the documented new-task deep link with a workspace and unsent prompt", () => {
  const jobUrl = "https://uk.indeed.com/viewjob?jk=deep1234&from=share";
  const workspacePath = "/Users/lawrenceawe/CV Fit Advisor";
  const deepLink = new URL(createTaskDeepLink({ jobUrl, workspacePath }));

  assert.equal(deepLink.protocol, "codex:");
  assert.equal(deepLink.host, "threads");
  assert.equal(deepLink.pathname, "/new");
  assert.equal(deepLink.searchParams.get("path"), workspacePath);
  assert.equal(deepLink.searchParams.get("prompt"), createTaskPrompt(jobUrl));
  assert.equal(createTaskPrompt(jobUrl), `$cv-fit-advisor\n${jobUrl}`);
});

test("encodes query-significant characters without changing the prompt", () => {
  const jobUrl = "https://uk.indeed.com/viewjob?jk=value%201&from=a+b";
  const workspacePath = "/tmp/CV Fit & Review";
  const deepLink = new URL(createTaskDeepLink({ jobUrl, workspacePath }));

  assert.equal(deepLink.searchParams.get("path"), workspacePath);
  assert.equal(deepLink.searchParams.get("prompt"), `$cv-fit-advisor\n${jobUrl}`);
});

test("requests auto-submit only when Sol, Medium, and Fast are already selected", () => {
  const jobUrl = "https://uk.indeed.com/viewjob?jk=configured1";
  const args = createAccessibilityHelperArguments({ jobUrl });
  const command = JSON.parse(args[1]);

  assert.equal(args[0], "auto-submit-if-configured");
  assert.equal(args.length, 2);
  assert.equal(command.jobUrl, jobUrl);
  assert.equal(new URL(command.newTaskUrl).searchParams.get("prompt"), `$cv-fit-advisor\n${jobUrl}`);
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

test("Accessibility helper never uses mouse events", async () => {
  const helperDirectory = new URL("../bridge/codex/accessibility-helper/", import.meta.url);
  const source = (await Promise.all(
    (await readdir(helperDirectory)).map((filename) => readFile(new URL(filename, helperDirectory), "utf8")),
  )).join("\n");

  assert.doesNotMatch(source, /mouseCursorPosition|mouseEventSource|leftMouse|rightMouse/);
  assert.match(source, /kAXFocusedAttribute/);
  assert.match(source, /kAXPressAction/);
  assert.doesNotMatch(source, /spaceKey|focusAndPressSpace/);
  assert.match(source, /returnKey/);
  assert.match(source, /findComposerModelPicker/);
  assert.match(source, /var isConfirmed: Bool/);
  assert.match(source, /preparedPromptGone/);
  assert.match(source, /freshClearedComposerCount/);
  assert.match(source, /preexistingClearedComposers/);
  assert.match(source, /settingsMenuSnapshots/);
  assert.match(source, /settingsMatch/);
  assert.match(source, /return \.readyForReview/);
  assert.match(source, /preexistingComposers/);
  assert.match(source, /NSWorkspace\.shared\.open\(request\.newTaskUrl\)/);
  assert.match(source, /freshComposers\.count > 1/);
  assert.match(source, /maximumPollInterval/);
  assert.match(source, /maxTreeNodeCount/);
  assert.match(source, /AutomationLock/);
  assert.match(source, /LOCK_EX \| LOCK_NB/);
  assert.match(source, /automation\.lock/);
  assert.doesNotMatch(source, /CommandLine\.arguments\[0\]/);
  assert.match(source, /Accessibility tree scan exceeded its deadline/);
  assert.doesNotMatch(source, /kAXFocusedWindowAttribute/);
  assert.doesNotMatch(source, /if !isMatchingComposer\(composer, jobURL: jobURL\)/);
});

test("compiled Accessibility helper publishes and self-tests its compatibility contract", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "cv-fit-ax-contract-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, "accessibility-helper");
  const helperDirectory = new URL("../bridge/codex/accessibility-helper/", import.meta.url);
  const helperSources = (await readdir(helperDirectory))
    .filter((filename) => filename.endsWith(".swift"))
    .map((filename) => fileURLToPath(new URL(filename, helperDirectory)));
  await execFileAsync("/usr/bin/swiftc", [
    ...helperSources,
    "-o",
    binary,
  ]);

  const metadata = JSON.parse((await execFileAsync(binary, ["metadata"])).stdout);
  assert.deepEqual(metadata, {
    protocolVersion: 6,
    contractVersion: "codex-desktop-en-v6",
  });
  assert.equal((await execFileAsync(binary, ["contract-self-test"])).stdout.trim(), "ok");
});

test("post-send confirmation stays in the composer subtree and uses the last observation on timeout", async () => {
  const source = await readFile(
    new URL("../bridge/codex/accessibility-helper/SubmissionAutomation.swift", import.meta.url), "utf8",
  );
  assert.match(source, /composerRoot = elementAttribute\(composer, kAXParentAttribute\)/);
  const afterSend = source.slice(source.indexOf("postKey(returnKey)"));
  assert.match(afterSend, /readSubmissionEvidence\(\s*in: composerRoot,/);
  assert.doesNotMatch(afterSend, /in: searchRoot|in: applicationRoot/);
  assert.equal(afterSend.match(/readSubmissionEvidence\(/g)?.length, 1);
  assert.match(afterSend, /consecutiveConfirmations >= 3/);
});

test("helper metadata does not require the automation lock", async () => {
  const source = await readFile(
    new URL("../bridge/codex/accessibility-helper/main.swift", import.meta.url),
    "utf8",
  );
  const metadataBranch = source.slice(
    source.indexOf('CommandLine.arguments[1] == "metadata"'),
    source.indexOf('CommandLine.arguments[1] == "contract-self-test"'),
  );

  assert.match(metadataBranch, /contractSelfTestPasses\(\)/);
  assert.doesNotMatch(metadataBranch, /AutomationLock/);
  assert.doesNotMatch(source.slice(0, source.indexOf('if CommandLine.arguments.count == 2')), /AutomationLock/);
});

test("task submissions use the precompiled Accessibility helper", async () => {
  const source = await readFile(new URL("../bridge/codex/task-runner.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /\/usr\/bin\/swift/);
  assert.doesNotMatch(source, /openTaskDraft/);
  assert.doesNotMatch(source, /\["contract-self-test"\]/);
  assert.match(source, /config\.codex\.accessibilityHelperPath/);
});

test("bridge requests stay shorter than the Accessibility operation", async () => {
  const serviceWorkerSource = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8"));
  const bridgeRequestTimeout = Number(
    serviceWorkerSource.match(/const REQUEST_TIMEOUT_MS = ([\d_]+);/)?.[1].replaceAll("_", ""),
  );

  assert.equal(accessibilityHelperTimeoutMs, 61_000);
  assert.ok(bridgeRequestTimeout < accessibilityHelperTimeoutMs);
});

test("menu status text describes submission rather than opening", async () => {
  const source = await readFile(new URL("../extension/submission.js", import.meta.url), "utf8");

  assert.match(source, /Submitting to Codex/);
  assert.match(source, /CV Fit Advisor task submitted/);
  assert.doesNotMatch(source, /Opening CV Fit Advisor|task started in Codex/);
});
