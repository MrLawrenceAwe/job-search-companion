import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openCvFitSubmissionStore } from "../../bridge/cv-fit-submission-store.js";

test("submission statuses survive restart and in-progress work becomes interrupted", async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "cv-fit-submissions-"));
  try {
    const path = join(directory, "submissions.json");
    const firstStore = await openCvFitSubmissionStore(path);
    firstStore.submissions.set("completed", { id: "completed", status: "submitted" });
    firstStore.submissions.set("active", { id: "active", status: "submitting" });
    await firstStore.save();

    const restartedStore = await openCvFitSubmissionStore(path);
    assert.deepEqual(restartedStore.submissions.get("completed"), {
      id: "completed", status: "submitted",
    });
    assert.deepEqual(restartedStore.submissions.get("active"), {
      id: "active",
      status: "interrupted",
      error: "The bridge restarted before this submission was confirmed",
    });
    assert.equal(JSON.parse(await readFile(path, "utf8")).submissions[1].status, "interrupted");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
