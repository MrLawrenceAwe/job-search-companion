(() => {
  const companion = globalThis.jobSearchCompanion;
  const { showToast } = companion;
  const messages = globalThis.jobSearchContracts.messages;
  const { statuses, helperResults } = globalThis.jobSearchContracts.cvFitSubmissions;

  const setActionLabel = (button, label) => {
    const labelElement = button?.querySelector?.(".jsc-menu-item-label");
    if (labelElement) {
      labelElement.textContent = label;
    }
  };

  const announce = (button, message) => {
    const status = button?.querySelector?.(".jsc-menu-item-status");
    if (status) {
      status.textContent = message;
    }
  };

  const sendBridgeRequest = (message) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(
            Object.assign(new Error("Couldn’t reach the Job Search Companion service. Check that it is running."), { uncertain: true }),
          );
        } else if (!response?.ok) {
          reject(new Error(response?.error || "Task submission failed"));
        } else {
          resolve(response);
        }
      });
    });

  const delay = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  let submissionInProgress = false;

  const waitForSubmissionResult = async (submissionId) => {
    const deadline = Date.now() + 220_000;
    while (Date.now() < deadline) {
      await delay(1000);
      const { submission } = await sendBridgeRequest({
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

  const submit = async (jobUrl, button) => {
    if (submissionInProgress) {
      showToast("A CV Fit Advisor submission is already in progress.");
      return;
    }

    submissionInProgress = true;
    const previousLabel = button
      ? button.querySelector(".jsc-menu-item-label")?.textContent || button.textContent
      : null;
    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      setActionLabel(button, "Submitting to Codex…");
      announce(button, "Submitting this job to Codex.");
    } else {
      showToast("Submitting this job to Codex…");
    }

    let accepted = false;
    try {
      const { submission } = await sendBridgeRequest({
        type: messages.submitCvFitTask,
        jobUrl,
      });
      if (!submission?.id) {
        throw Object.assign(new Error("The local bridge did not return a submission ID"), { uncertain: true });
      }
      accepted = true;
      const status = await waitForSubmissionResult(submission.id);
      if (status === statuses.unconfirmed) {
        showToast("Send was attempted, but Codex confirmation timed out. The task may already be running—check Codex before retrying.", "warning");
        return;
      }
      showToast(
        status === statuses.submitted
          ? "CV Fit Advisor task submitted."
          : `CV Fit Advisor draft is ready—check ${globalThis.jobSearchContracts.cvFitSettings.map(({ category, label }) => `${category}: ${label}`).join(", ")} in Codex, then send it.`,
      );
    } catch (error) {
      const uncertain = error.uncertain || (accepted && !error.definiteFailure);
      showToast(
        uncertain
          ? `Couldn’t confirm the CV Fit Advisor submission. Check Codex before retrying: ${error.message}`
          : `CV Fit Advisor submission failed: ${error.message}`,
        uncertain ? "warning" : "error",
      );
    } finally {
      submissionInProgress = false;
      if (button) {
        button.disabled = false;
        button.setAttribute("aria-busy", "false");
        setActionLabel(button, previousLabel);
      }
    }
  };

  companion.cvFitSubmissions.submit = submit;
})();
