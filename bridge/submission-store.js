import { readOptionalFile, atomicWrite, assertNoSymbolicLinkPaths } from "../shared/filesystem.js";

const STORE_VERSION = 1;
const INTERRUPTED_ERROR = "The bridge restarted before this submission was confirmed";

export const openSubmissionStore = async (path) => {
  await assertNoSymbolicLinkPaths([path]);
  const contents = await readOptionalFile(path);
  let entries = [];
  if (contents !== null) {
    const state = JSON.parse(contents);
    if (state.version !== STORE_VERSION || !Array.isArray(state.submissions)
        || state.submissions.some((submission) => (
          typeof submission?.id !== "string"
          || !["submitting", "submitted", "ready_for_review", "failed", "interrupted"].includes(submission.status)
        ))) {
      throw new Error(`Invalid submission state: ${path}`);
    }
    entries = state.submissions;
  }

  const submissions = new Map(entries.map((submission) => [submission.id, submission]));
  const save = () => atomicWrite(path, `${JSON.stringify({
    version: STORE_VERSION,
    submissions: [...submissions.values()],
  }, null, 2)}\n`, 0o600);

  let interrupted = false;
  for (const [id, submission] of submissions) {
    if (submission.status === "submitting") {
      submissions.set(id, { id, status: "interrupted", error: INTERRUPTED_ERROR });
      interrupted = true;
    }
  }
  if (interrupted) {
    await save();
  }
  return { submissions, save };
};
