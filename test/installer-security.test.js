import assert from "node:assert/strict";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { atomicWrite } from "../installer/file-transaction.js";
import { installFixture, makeInstallFixture } from "../test-support/install-fixture.js";

test("install rejects symbolic-link targets before changing managed files", async (context) => {
  const paths = await makeInstallFixture(context);
  const linkedHelperTarget = join(paths.accessibilityHelperTarget, "..", "linked-helper");
  await mkdir(join(paths.accessibilityHelperTarget, ".."), { recursive: true });
  await writeFile(linkedHelperTarget, "user file through a symbolic link\n");
  await symlink(linkedHelperTarget, paths.accessibilityHelperTarget);

  await assert.rejects(installFixture(paths), /may not be symbolic links/);

  assert.equal((await lstat(paths.accessibilityHelperTarget)).isSymbolicLink(), true);
  assert.equal(await readFile(linkedHelperTarget, "utf8"), "user file through a symbolic link\n");
  await assert.rejects(readFile(paths.extensionConfigPath, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(paths.plistTarget, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(paths.statePath, "utf8"), { code: "ENOENT" });
});

test("install rejects symbolic-link parent directories before changing managed files", async (context) => {
  const paths = await makeInstallFixture(context);
  const realHelperDirectory = join(paths.accessibilityHelperTarget, "..", "..", "real-helper");
  const linkedHelperDirectory = join(paths.accessibilityHelperTarget, "..", "..", "linked-helper");
  await mkdir(realHelperDirectory, { recursive: true });
  await symlink(realHelperDirectory, linkedHelperDirectory);
  paths.accessibilityHelperTarget = join(linkedHelperDirectory, "accessibility-helper");

  await assert.rejects(installFixture(paths), /may not be symbolic links/);

  await assert.rejects(readFile(join(realHelperDirectory, "accessibility-helper"), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(paths.extensionConfigPath, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(paths.plistTarget, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(paths.statePath, "utf8"), { code: "ENOENT" });
});

test("atomic writes do not follow predictable temporary-file symbolic links", async (context) => {
  const paths = await makeInstallFixture(context);
  const outputPath = join(paths.extensionConfigPath, "..", "atomic-output.txt");
  const linkedTarget = join(paths.extensionConfigPath, "..", "linked-target.txt");
  const predictableTemporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(linkedTarget, "original target\n");
  await symlink(linkedTarget, predictableTemporaryPath);

  await atomicWrite(outputPath, "installed content\n", 0o600);

  assert.equal(await readFile(outputPath, "utf8"), "installed content\n");
  assert.equal(await readFile(linkedTarget, "utf8"), "original target\n");
  assert.equal((await lstat(predictableTemporaryPath)).isSymbolicLink(), true);
});
