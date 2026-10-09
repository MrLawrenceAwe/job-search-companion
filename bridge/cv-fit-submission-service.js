import { randomUUID } from "node:crypto";
import { cvFitSubmissionContract } from "../shared/contracts.js";

const { statuses } = cvFitSubmissionContract;

export const createCvFitSubmissionService = ({
  submissionStore, analysisStore, submitTask, logger, createSubmissionId = randomUUID,
}) => {
  const { submissions } = submissionStore;
  let activeSubmissionId = null;
  const maximumCompletedSubmissions = 50;

  const pruneCompletedSubmissions = () => {
    const completedIds = [...submissions]
      .filter(([, submission]) => submission.status !== statuses.submitting)
      .map(([id]) => id);
    for (const id of completedIds.slice(0, -maximumCompletedSubmissions)) {
      submissions.delete(id);
    }
  };

  const runSubmission = async (submissionId, jobUrl, completion) => {
    let completedSubmission;
    try {
      const { status } = await submitTask({ jobUrl, completion });
      completedSubmission = { id: submissionId, status };
      logger.info(`CV Fit task automation completed: ${completedSubmission.status}`);
    } catch (error) {
      completedSubmission = {
        id: submissionId,
        status: statuses.failed,
        error: error instanceof Error ? error.message : String(error),
      };
      logger.warn(`CV Fit task submission failed: ${completedSubmission.error}`);
    } finally {
      submissions.set(submissionId, completedSubmission);
      pruneCompletedSubmissions();
      try {
        await submissionStore.save();
      } catch (error) {
        logger.error("Could not persist completed CV Fit task submission:", error);
      }
      if (activeSubmissionId === submissionId) {
        activeSubmissionId = null;
      }
    }
  };

  return {
    get: (id) => submissions.get(id),
    async start(jobUrl) {
      if (activeSubmissionId !== null) {
        throw Object.assign(new Error("A CV Fit Advisor task is already being submitted in Codex"), { status: 409 });
      }

      const submissionId = createSubmissionId();
      const submission = { id: submissionId, status: statuses.submitting };
      submissions.set(submissionId, submission);
      activeSubmissionId = submissionId;
      let completion;
      try {
        await submissionStore.save();
        completion = await analysisStore.create({ id: submissionId, jobUrl });
      } catch (error) {
        submissions.delete(submissionId);
        activeSubmissionId = null;
        logger.error("Could not persist CV Fit task submission:", error);
        throw Object.assign(new Error("Could not save the submission status"), { status: 503 });
      }
      logger.info("CV Fit task submission started");
      void runSubmission(submissionId, jobUrl, completion);
      return submission;
    },
  };
};
