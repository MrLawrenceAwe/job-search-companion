import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";

import { atomicWrite } from "../../shared/filesystem.js";
import { uninstall } from "../../installer/lifecycle.js";
import { installFixture, makeInstallFixture } from "../../test-support/install-fixture.js";

test("uninstall preserves every artifact when one changed after installation", async (context) => {
  const paths = await makeInstallFixture(context);
  await installFixture(paths);
  const installedPlist = await readFile(paths.plistTarget, "utf8");
  await writeFile(paths.extensionConfigPath, "user changed this after install\n");

  await assert.rejects(uninstall({ statePath: paths.statePath }), /changed after installation/);

  assert.equal(await readFile(paths.extensionConfigPath, "utf8"), "user changed this after install\n");
  assert.equal(await readFile(paths.plistTarget, "utf8"), installedPlist);
  assert.equal(JSON.parse(await readFile(paths.statePath, "utf8")).version, 11);
});

test("uninstall rolls back when restoring an artifact fails", async (context) => {
  const paths = await makeInstallFixture(context);
  await writeFile(paths.extensionConfigPath, "previous extension config\n");
  await installFixture(paths);
  const installedPlist = await readFile(paths.plistTarget, "utf8");

  await assert.rejects(uninstall({ statePath: paths.statePath }, {
    atomicWrite: async (path, content, mode) => {
      if (path === paths.extensionConfigPath) {
        throw new Error("simulated restore failure");
      }
      return atomicWrite(path, content, mode);
    },
  }), /simulated restore failure/);

  assert.equal(await readFile(paths.plistTarget, "utf8"), installedPlist);
  assert.equal(JSON.parse(await readFile(paths.statePath, "utf8")).version, 11);
});

test("install rolls every artifact back when Accessibility helper cannot be installed", async (context) => {
  const paths = await makeInstallFixture(context);
  await assert.rejects(installFixture(paths, {
    atomicWrite: async (path, content, mode) => {
      if (path === paths.accessibilityHelperTarget) {
        throw new Error("simulated Accessibility helper failure");
      }
      return atomicWrite(path, content, mode);
    },
  }), /simulated Accessibility helper failure/);

  await assert.rejects(readFile(paths.extensionConfigPath), { code: "ENOENT" });
  await assert.rejects(readFile(paths.plistTarget), { code: "ENOENT" });
  await assert.rejects(readFile(paths.accessibilityHelperTarget), { code: "ENOENT" });
  await assert.rejects(readFile(paths.statePath), { code: "ENOENT" });
});

test("uninstall restores a pre-existing binary Accessibility helper", async (context) => {
  const paths = await makeInstallFixture(context);
  const originalHelper = Buffer.from([1, 0, 255, 2]);
  await mkdir(dirname(paths.accessibilityHelperTarget), { recursive: true });
  await writeFile(paths.accessibilityHelperTarget, originalHelper);

  await installFixture(paths);
  const state = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(state.version, 11);
  assert.equal(
    state.artifacts.accessibilityHelper.previousContentBase64,
    originalHelper.toString("base64"),
  );
  assert.equal("previousContent" in state.artifacts.accessibilityHelper, false);

  await uninstall({ statePath: paths.statePath });

  assert.deepEqual(await readFile(paths.accessibilityHelperTarget), originalHelper);
});
