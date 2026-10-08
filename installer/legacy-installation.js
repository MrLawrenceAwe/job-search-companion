import { access, rename } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { assertNoSymbolicLinkPaths, atomicWrite, readOptionalFile } from "../shared/filesystem.js";

const exists = (path) =>
  access(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

// A one-time move, not an alternate runtime configuration. Keep the old state
// available to rollback until the replacement service has passed its health check.
export const migrateInstallation = async ({ homePath }) => {
  const source = join(homePath, "Library/Application Support/Indeed CV Fit Bridge");
  const target = join(homePath, "Library/Application Support/Job Search Companion");
  await assertNoSymbolicLinkPaths([source, target]);
  if (!(await exists(source))) return;
  if (await exists(target))
    throw new Error(
      "Both bridge data directories exist. Resolve them before migrating; no data was overwritten.",
    );
  const statePath = join(source, "install-state.json");
  const stateText = await readOptionalFile(statePath);
  let migratedState = null;
  if (stateText !== null) {
    const state = JSON.parse(stateText);
    for (const artifact of Object.values(state.artifacts)) {
      const suffix = relative(source, artifact.path);
      if (suffix && suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix)) {
        artifact.path = join(target, suffix);
      }
    }
    migratedState = `${JSON.stringify(state, null, 2)}\n`;
  }
  await rename(source, target);
  try {
    if (migratedState !== null)
      await atomicWrite(join(target, "install-state.json"), migratedState, 0o600);
  } catch (error) {
    await rename(target, source);
    // atomicWrite either completed or preserved the original file.
    await atomicWrite(statePath, stateText, 0o600);
    throw error;
  }
};
