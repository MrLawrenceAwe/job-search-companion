import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createFileLogger } from "../../bridge/logger.js";

test("file logger writes private logs and retains only bounded rotated files", async (context) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "cv-fit-logger-")));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const logPath = join(directory, "private", "bridge.log");
  const logger = createFileLogger(logPath, { maximumBytes: 80, retainedFiles: 2 });

  logger.info("first message that fills the initial file");
  logger.warn("second message rotates the initial file");
  logger.error("third message rotates once more");
  logger.info("fourth message drops the oldest file");

  assert.equal((await stat(join(directory, "private"))).mode & 0o777, 0o700);
  assert.equal((await stat(logPath)).mode & 0o777, 0o600);
  assert.match(await readFile(logPath, "utf8"), /INFO fourth message/);
  assert.match(await readFile(`${logPath}.1`, "utf8"), /ERROR third message/);
  assert.match(await readFile(`${logPath}.2`, "utf8"), /WARN second message/);
  await assert.rejects(stat(`${logPath}.3`), { code: "ENOENT" });
});

test("file logger leaves an existing log directory mode unchanged", async (context) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "cv-fit-logger-existing-")));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o755);

  const logger = createFileLogger(join(directory, "bridge.log"));
  logger.info("test");

  assert.equal((await stat(directory)).mode & 0o777, 0o755);
  assert.equal((await stat(join(directory, "bridge.log"))).mode & 0o777, 0o600);
});
