import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Historical comparisons need the revision's own contracts and dependencies.
// Importing old source against current modules changes the baseline being measured.
export const openRevision = async (ref, { repositoryRoot = root } = {}) => {
  const directory = await mkdtemp(join(tmpdir(), "jsc-evaluation-revision-"));
  try {
    const archive = execFileSync("git", ["archive", ref], { cwd: repositoryRoot, maxBuffer: 20_000_000 });
    execFileSync("tar", ["-xf", "-", "-C", directory], { input: archive });
    await symlink(join(root, "node_modules"), join(directory, "node_modules"));
    return {
      directory,
      importModule: (path) => import(pathToFileURL(join(directory, path)).href),
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};
