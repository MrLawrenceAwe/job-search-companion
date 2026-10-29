import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { runScriptsInVm } from "../../test-support/extension-scripts.js";

test("shared submission client follows terminal states and preserves uncertainty", async () => {
  const context = vm.createContext({ window: { setTimeout: (callback) => callback() } });
  await runScriptsInVm(context, ["contracts/messages.js", "contracts/cv-fit-submissions.js",
    "contracts/cv-fit-settings.js", "cv-fit-client.js"]);
  const client = context.jobSearchCvFitClient;
  for (const status of ["submitted", "ready_for_review", "unconfirmed", "failed", "interrupted"]) {
    const monitor = client.createClient(async (message) => {
      assert.equal(message.submissionId, "submission-1");
      return { submission: { status, error: "terminal detail" } };
    });
    if (["failed", "interrupted"].includes(status)) {
      await assert.rejects(monitor.waitForSubmissionResult("submission-1"), (error) => {
        const result = client.failureMessage(error, true);
        assert.equal(result.kind, status === "failed" ? "error" : "warning");
        return true;
      });
    } else {
      assert.equal(await monitor.waitForSubmissionResult("submission-1"), status);
      assert.match(client.resultMessage(status), status === "submitted" ? /task submitted/
        : status === "ready_for_review" ? /draft is ready/ : /check Codex before retrying/);
    }
  }
  const disconnected = client.createClient(async () => { throw new Error("Connection lost"); });
  await assert.rejects(disconnected.waitForSubmissionResult("submission-1"), (error) => {
    assert.equal(client.failureMessage(error, true).kind, "warning");
    return true;
  });
});
