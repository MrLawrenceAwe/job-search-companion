import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("Accessibility helper health verifies the managed helper and rejects later drift", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "cv-fit-accessibility-helper-health-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const binaryPath = join(directory, "accessibility-helper");
  const statePath = join(directory, "install-state.json");
  const helper = '#!/bin/sh\nprintf \'%s\\n\' \'{"protocolVersion":6,"contractVersion":"codex-desktop-en-v6"}\'\n';
  await writeFile(binaryPath, helper);
  await chmod(binaryPath, 0o700);
  await mkdir(join(statePath, ".."), { recursive: true });
  const state = {
    version: 11,
    artifacts: {
      accessibilityHelper: {
        path: binaryPath,
        installedHash: createHash("sha256").update(helper).digest("hex"),
        binary: true,
      },
    },
  };
  await writeFile(statePath, JSON.stringify(state));

  process.env.INDEED_CV_FIT_BRIDGE_TOKEN = "test-token";
  process.env.INDEED_CV_FIT_EXTENSION_ORIGIN = "chrome-extension://test";
  process.env.CODEX_ACCESSIBILITY_HELPER_PATH = binaryPath;
  process.env.INDEED_CV_FIT_INSTALL_STATE_PATH = statePath;
  const { readAccessibilityHelperHealth } = await import("../bridge/codex/helper-health.js");

  assert.deepEqual(await readAccessibilityHelperHealth(), {
    ready: true,
    protocolVersion: 6,
    contractVersion: "codex-desktop-en-v6",
    hashMatchesInstallState: true,
  });

  const executionMarker = join(directory, "modified-helper-executed");
  await writeFile(
    binaryPath,
    `#!/bin/sh\nprintf executed > '${executionMarker}'\n`,
  );
  assert.deepEqual(await readAccessibilityHelperHealth(), {
    ready: false,
    hashMatchesInstallState: false,
    error: "Accessibility helper hash does not match install state",
  });
  await assert.rejects(stat(executionMarker), { code: "ENOENT" });
});
