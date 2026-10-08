import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

import { readRetiredArtifactPaths } from "../installer/install-state.js";
import { uninstall } from "../installer/lifecycle.js";
import { installFixture, makeInstallFixture, sha256 } from "../test-support/install-fixture.js";

test("install and uninstall manage only bridge-owned artifacts", async (context) => {
  const paths = await makeInstallFixture(context);
  await installFixture(paths);

  assert.equal((await stat(paths.extensionConfigPath)).mode & 0o777, 0o600);
  assert.equal((await stat(paths.plistTarget)).mode & 0o777, 0o600);
  assert.equal(
    await readFile(paths.plistTarget, "utf8"),
    `node=${process.execPath.replaceAll("&", "&amp;")} root=${paths.rootPath.replace("&", "&amp;")} workspace=${paths.workspacePath.replace("&", "&amp;")} log=${paths.logPath.replace("&", "&amp;")} token=test-token origin=chrome-extension://abcdefghijklmnopabcdefghijklmnop instance=test-instance-id\n`,
  );
  assert.deepEqual(await readFile(paths.accessibilityHelperTarget), Buffer.from([0, 255, 1, 254, 2]));
  assert.equal((await stat(paths.accessibilityHelperTarget)).mode & 0o777, 0o700);

  await uninstall({ statePath: paths.statePath });

  await assert.rejects(readFile(paths.extensionConfigPath), { code: "ENOENT" });
  await assert.rejects(readFile(paths.plistTarget), { code: "ENOENT" });
  await assert.rejects(readFile(paths.accessibilityHelperTarget), { code: "ENOENT" });
  await assert.rejects(readFile(paths.statePath), { code: "ENOENT" });
});

test("reinstall preserves absent-file snapshots for uninstall", async (context) => {
  const paths = await makeInstallFixture(context);
  await installFixture(paths);
  await installFixture(paths);
  await uninstall({ statePath: paths.statePath });

  await assert.rejects(readFile(paths.extensionConfigPath), { code: "ENOENT" });
  await assert.rejects(readFile(paths.plistTarget), { code: "ENOENT" });
  await assert.rejects(readFile(paths.accessibilityHelperTarget), { code: "ENOENT" });
});

test("reinstall retires managed artifacts whose target paths changed", async (context) => {
  const paths = await makeInstallFixture(context);
  await installFixture(paths);

  const movedPaths = {
    extensionConfigPath: join(dirname(paths.extensionConfigPath), "moved-local-config.js"),
    plistTarget: join(dirname(paths.plistTarget), "moved-bridge.plist"),
    accessibilityHelperTarget: join(
      dirname(paths.accessibilityHelperTarget),
      "moved-accessibility-helper",
    ),
  };
  const originalContents = {
    extensionConfig: "original moved extension config\n",
    launchAgent: "original moved launch agent\n",
    accessibilityHelper: Buffer.from([7, 0, 255, 8]),
  };
  await Promise.all([
    writeFile(movedPaths.extensionConfigPath, originalContents.extensionConfig),
    writeFile(movedPaths.plistTarget, originalContents.launchAgent),
    writeFile(movedPaths.accessibilityHelperTarget, originalContents.accessibilityHelper),
  ]);

  await installFixture({ ...paths, ...movedPaths });

  await Promise.all([
    assert.rejects(readFile(paths.extensionConfigPath), { code: "ENOENT" }),
    assert.rejects(readFile(paths.plistTarget), { code: "ENOENT" }),
    assert.rejects(readFile(paths.accessibilityHelperTarget), { code: "ENOENT" }),
  ]);

  await uninstall({ statePath: paths.statePath });

  assert.equal(await readFile(movedPaths.extensionConfigPath, "utf8"), originalContents.extensionConfig);
  assert.equal(await readFile(movedPaths.plistTarget, "utf8"), originalContents.launchAgent);
  assert.deepEqual(
    await readFile(movedPaths.accessibilityHelperTarget),
    originalContents.accessibilityHelper,
  );
});

test("reinstall restores retired workspace configuration from a version 11 state", async (context) => {
  const paths = await makeInstallFixture(context);
  const workspaceConfigPath = join(paths.statePath, "..", "workspace-config.toml");
  await mkdir(dirname(workspaceConfigPath), { recursive: true });
  await writeFile(workspaceConfigPath, 'model = "managed"\n');
  await writeFile(paths.statePath, JSON.stringify({
    version: 11,
    artifacts: {
      workspaceConfig: {
        path: workspaceConfigPath,
        previousContent: 'model = "original"\n',
        previousMode: 0o640,
        installedHash: sha256('model = "managed"\n'),
      },
    },
  }));

  await installFixture(paths);

  assert.equal(await readFile(workspaceConfigPath, "utf8"), 'model = "original"\n');
  const nextState = JSON.parse(await readFile(paths.statePath, "utf8"));
  assert.equal(Object.hasOwn(nextState.artifacts, "workspaceConfig"), false);
});

test("lists retired artifacts that a launch failure must restore", async (context) => {
  const paths = await makeInstallFixture(context);
  const globalConfigPath = join(paths.statePath, "..", "global-config.toml");
  const workspaceConfigPath = join(paths.statePath, "..", "workspace-config.toml");
  await mkdir(dirname(globalConfigPath), { recursive: true });
  await writeFile(paths.statePath, JSON.stringify({
    version: 11,
    artifacts: {
      globalConfig: { path: globalConfigPath },
      workspaceConfig: { path: workspaceConfigPath },
    },
  }));

  assert.deepEqual(await readRetiredArtifactPaths(paths.statePath), [
    { name: "globalConfig", path: globalConfigPath },
    { name: "workspaceConfig", path: workspaceConfigPath },
  ]);
});
