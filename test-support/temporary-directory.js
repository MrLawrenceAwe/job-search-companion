import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const makeTemporaryDirectory = async (context, prefix, beforeRemove = () => {}) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), prefix));
  context.after(async () => {
    try {
      await beforeRemove();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  return directory;
};
