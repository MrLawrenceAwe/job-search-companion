(() => {
  const { messages, cvFitSubmissions: { statuses, helperResults } } = globalThis.jobSearchContracts;
  const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  const readSubmission = (response, { starting = false } = {}) => {
    if (!response?.ok) {
      const uncertain = response?.uncertain === true || (starting && !response);
      throw Object.assign(new Error(response?.error || (starting ? "Task submission failed" : "Submission status unavailable")), {
        uncertain, definiteFailure: starting && !uncertain,
      });
    }
    const submission = response.submission;
    if (starting && (typeof submission?.id !== "string" || !submission.id))
      throw Object.assign(new Error("The local bridge did not return a submission ID"), { uncertain: true });
    return submission;
  };
  const createClient = (sendRequest) => {
    const waitForSubmissionResult = async (submissionId) => {
      const deadline = Date.now() + 220_000;
      while (Date.now() < deadline) {
        await delay(1000);
        const submission = readSubmission(await sendRequest({
          type: messages.getCvFitSubmissionStatus,
          submissionId,
        }));
        if (helperResults.includes(submission?.status)) {
          return submission.status;
        }
        if (submission?.status === statuses.failed) {
          throw Object.assign(new Error(submission.error || "Task submission failed"), { definiteFailure: true });
        }
        if (submission?.status === statuses.interrupted) {
          throw Object.assign(new Error(submission.error || "The bridge restarted. Check Codex before retrying."), { uncertain: true });
        }
      }
      throw Object.assign(new Error("Codex submission did not finish within 220 seconds"), { uncertain: true });
    };

    return { waitForSubmissionResult };
  };
  const resultMessage = (status) => status === statuses.unconfirmed
    ? "Send was attempted, but Codex confirmation timed out. The task may already be running—check Codex before retrying."
    : status === statuses.submitted ? "CV Fit Advisor task submitted."
      : "CV Fit Advisor draft is ready. Review its settings in Codex, then send it.";
  const failureMessage = (error, accepted = false) => {
    const uncertain = error.uncertain || (accepted && !error.definiteFailure);
    return { message: uncertain
      ? `Couldn’t confirm the CV Fit Advisor submission. Check Codex before retrying: ${error.message}`
      : `CV Fit Advisor submission failed: ${error.message}`, kind: uncertain ? "warning" : "error" };
  };
  globalThis.jobSearchCvFitClient = { createClient, readSubmission, resultMessage, failureMessage };
})();
