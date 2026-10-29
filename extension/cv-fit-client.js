(() => {
  const { messages, cvFitSubmissions: { statuses, helperResults }, cvFitSettings } = globalThis.jobSearchContracts;
  const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  const createClient = (sendRequest) => {
    const waitForSubmissionResult = async (submissionId) => {
      const deadline = Date.now() + 220_000;
      while (Date.now() < deadline) {
        await delay(1000);
        const { submission } = await sendRequest({
          type: messages.getCvFitSubmissionStatus,
          submissionId,
        });
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
      : `CV Fit Advisor draft is ready—check ${cvFitSettings.map(({ category, label }) => `${category}: ${label}`).join(", ")} in Codex, then send it.`;
  const failureMessage = (error, accepted = false) => {
    const uncertain = error.uncertain || (accepted && !error.definiteFailure);
    return { message: uncertain
      ? `Couldn’t confirm the CV Fit Advisor submission. Check Codex before retrying: ${error.message}`
      : `CV Fit Advisor submission failed: ${error.message}`, kind: uncertain ? "warning" : "error" };
  };
  globalThis.jobSearchCvFitClient = { createClient, resultMessage, failureMessage };
})();
