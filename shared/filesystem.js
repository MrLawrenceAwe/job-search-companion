import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const fileExists = async (path) => access(path).then(() => true, () => false);

export const readOptionalFile = async (path, encoding = "utf8") =>
  (await fileExists(path) ? readFile(path, encoding ?? undefined) : null);

const symbolicLinkAt = async (path) => lstat(path).then(
  (stats) => (stats.isSymbolicLink() ? path : null),
  (error) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  },
);

export const assertNoSymbolicLinkPaths = async (paths) => {
  const symbolicLinkPaths = [];
  const checkedPaths = new Set();
  for (const path of new Set(paths.filter(Boolean).map((candidate) => resolve(candidate)))) {
    const components = [];
    for (let component = path; ; component = dirname(component)) {
      components.push(component);
      if (dirname(component) === component) {
        break;
      }
    }
    for (const component of components.reverse()) {
      if (checkedPaths.has(component)) {
        continue;
      }
      checkedPaths.add(component);
      const symbolicLinkPath = await symbolicLinkAt(component);
      if (symbolicLinkPath) {
        symbolicLinkPaths.push(symbolicLinkPath);
      }
    }
  }
  if (symbolicLinkPaths.length > 0) {
    throw new Error(`Managed paths may not be symbolic links:\n${symbolicLinkPaths.join("\n")}`);
  }
};

export const atomicWrite = async (path, content, mode) => {
  await assertNoSymbolicLinkPaths([path]);
  await mkdir(dirname(path), { recursive: true });
  const existingMode = await stat(path).then((stats) => stats.mode & 0o777, () => null);
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let temporaryFile;
  try {
    temporaryFile = await open(temporaryPath, "wx", mode ?? existingMode ?? 0o600);
    await temporaryFile.chmod(mode ?? existingMode ?? 0o600);
    await temporaryFile.writeFile(content, typeof content === "string" ? "utf8" : undefined);
    await temporaryFile.close();
    temporaryFile = null;
    await rename(temporaryPath, path);
  } catch (error) {
    await temporaryFile?.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
};
