import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWrite } from "../../shared/filesystem.js";

export const openPrivateStore = async (path, initial) => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    value = structuredClone(initial);
  }
  let writes = Promise.resolve();
  return {
    value,
    save() {
      const snapshot = JSON.stringify(value);
      const write = () => atomicWrite(path, snapshot, 0o600);
      writes = writes.catch(() => {}).then(write);
      return writes;
    },
  };
};
