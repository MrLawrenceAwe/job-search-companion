import { randomUUID } from "node:crypto";
import { cvFitSubmissionContract } from "../shared/contracts.js";

const { statuses } = cvFitSubmissionContract;

export const createCvFitSubmissionService = ({
  submissionStore, analysisStore, submitTask, logger, createSubmissionId = randomUUID,
}) => {
  const { submissions } = submissionStore;
  let activeSubmissionId = null;
  const maximumTerminalSubmissions = 50;

  const pruneTerminalSubmissions = () => {
    const terminalIds = [...submissions]
      .filter(([, submission]) => submission.status !== statuses.submitting)
      .map(([id]) => id);
    for (const id of terminalIds.slice(0, -maximumTerminalSubmissions)) {
      submissions.delete(id);
    }
  };

  const runSubmission = async (submissionId, jobUrl, completion) => {
    let terminalSubmission;
    try {
      const { status } = await submitTask({ jobUrl, completion });
      terminalSubmission = { id: submissionId, status };
      logger.info(`CV Fit task automation completed: ${terminalSubmission.status}`);
    } catch (error) {
      terminalSubmission = {
        id: submissionId,
        status: statuses.failed,
        error: error instanceof Error ? error.message : String(error),
      };
      logger.warn(`CV Fit task submission failed: ${terminalSubmission.error}`);
    } finally {
      submissions.set(submissionId, terminalSubmission);
      pruneTerminalSubmissions();
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
