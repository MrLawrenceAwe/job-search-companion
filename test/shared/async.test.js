import assert from "node:assert/strict";
import test from "node:test";
import { drainEventLoopUntil, waitUntil } from "../../test-support/async.js";

for (const wait of [drainEventLoopUntil, waitUntil]) {
  test(`${wait.name} succeeds when work reaches the condition`, async () => {
    let ready = false;
    setImmediate(() => { ready = true; });
    await wait(() => ready);
    assert.equal(ready, true);
  });

  test(`${wait.name} fails with the supplied message after exhausting attempts`, async () => {
    let reads = 0;
    await assert.rejects(wait(() => { reads += 1; return false; }, {
      attempts: 2, intervalMs: 0, message: "Result never arrived",
    }), { message: "Result never arrived" });
    assert.equal(reads, 3);
  });
}
