import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("Accessibility helper never uses mouse events", async () => {
  const helperDirectory = new URL("../../../bridge/codex/accessibility-helper/", import.meta.url);
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
  const helperDirectory = new URL("../../../bridge/codex/accessibility-helper/", import.meta.url);
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
    new URL("../../../bridge/codex/accessibility-helper/SubmissionAutomation.swift", import.meta.url), "utf8",
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
    new URL("../../../bridge/codex/accessibility-helper/main.swift", import.meta.url),
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
