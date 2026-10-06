import assert from "node:assert/strict";
import test from "node:test";

import { runCommand } from "../bridge/run-command.js";

test("waits for a timed-out command to terminate and escalates when SIGTERM is ignored", async () => {
  const startedAt = Date.now();

  await assert.rejects(
    runCommand("/bin/sh", ["-c", "trap '' TERM; while :; do :; done"], {
      timeoutMs: 30,
      killGraceMs: 40,
    }),
    /timed out/,
  );

  assert.ok(Date.now() - startedAt >= 60);
});
