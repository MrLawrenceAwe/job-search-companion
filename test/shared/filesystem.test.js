import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { atomicWrite } from "../../shared/filesystem.js";

test("atomic writes do not follow predictable temporary-file symbolic links", async (context) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-filesystem-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = join(directory, "atomic-output.txt");
  const linkedTarget = join(directory, "linked-target.txt");
  const predictableTemporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(linkedTarget, "original target\n");
  await symlink(linkedTarget, predictableTemporaryPath);

  await atomicWrite(outputPath, "installed content\n", 0o600);

  assert.equal(await readFile(outputPath, "utf8"), "installed content\n");
  assert.equal(await readFile(linkedTarget, "utf8"), "original target\n");
  assert.equal((await lstat(predictableTemporaryPath)).isSymbolicLink(), true);
});
