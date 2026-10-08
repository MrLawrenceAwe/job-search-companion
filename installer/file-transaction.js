import { rm, stat } from "node:fs/promises";

import { atomicWrite, readOptionalFile } from "../shared/filesystem.js";

const snapshotFile = async (path, encoding = "utf8") => ({
  path,
  content: await readOptionalFile(path, encoding),
  mode: await stat(path).then((stats) => stats.mode & 0o777, () => null),
});

const restoreSnapshot = async (snapshot) => {
  if (snapshot.content === null) {
    await rm(snapshot.path, { force: true });
  } else {
    await atomicWrite(snapshot.path, snapshot.content, snapshot.mode);
  }
};

export const runFileTransaction = async ({
  paths,
  binaryPaths = new Set(),
  failureMessage,
  action,
}) => {
  const snapshots = await Promise.all([...new Set(paths)].map((path) =>
    snapshotFile(path, binaryPaths.has(path) ? null : "utf8")));
  try {
    return await action();
  } catch (error) {
    const rollbackFailures = [];
    for (const snapshot of snapshots.reverse()) {
      try {
        await restoreSnapshot(snapshot);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        [error, ...rollbackFailures],
        `${failureMessage}: ${error.message}`,
      );
    }
    throw error;
  }
};
