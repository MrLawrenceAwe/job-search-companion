import assert from "node:assert/strict";
import test from "node:test";
import { loadWorker } from "../../test-support/worker-fixture.js";

test("malformed bridge JSON retains each feature's failure response", async () => {
  const worker = await loadWorker(async () => ({
    ok: false,
    status: 502,
    json: async () => { throw new SyntaxError("Invalid JSON"); },
  }));
  const submission = await worker.request({
    type: "SUBMIT_CV_FIT_TASK",
    jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111",
  });
  assert.equal(submission.error, "Request failed with status 502");
  const check = await new Promise((resolve) => worker.messageHandler(
    { type: "BLOCKER_REQUEST", action: "status" },
    { url: "https://uk.indeed.com/jobs" },
    resolve,
  ));
  assert.equal(check.error, "Local checker unavailable. Check that the bridge is running.");
});
