import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openRevision } from "../../scripts/evaluations/revision.js";

// A changed working-tree dependency must never alter a historical baseline.
test("evaluation snapshots use committed dependencies and remove temporary files", async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "jsc-revision-test-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: repositoryRoot });
  git("init", "-q");
  await writeFile(join(repositoryRoot, "package.json"), '{"type":"module"}');
  await writeFile(join(repositoryRoot, "contract.js"), 'export const value = "committed";');
  await writeFile(join(repositoryRoot, "entry.js"), 'export { value } from "./contract.js";');
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "Fixture");
  await writeFile(join(repositoryRoot, "contract.js"), 'export const value = "working tree";');
  const revision = await openRevision("HEAD", { repositoryRoot });
  try {
    assert.equal((await revision.importModule("entry.js")).value, "committed");
    assert.match(await readFile(join(repositoryRoot, "contract.js"), "utf8"), /working tree/);
  } finally {
    await revision.close();
  }
  await assert.rejects(access(revision.directory), { code: "ENOENT" });
});
