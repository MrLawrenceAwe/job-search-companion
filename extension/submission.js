(() => {
  const companion = globalThis.jobSearchCompanion;
  const { showToast } = companion;

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
            new Error("Couldn’t reach the Job Search Companion service. Check that it is running."),
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

  const waitForCompletion = async (submissionId) => {
    const deadline = Date.now() + 220_000;
    while (Date.now() < deadline) {
      await delay(1000);
      const { submission } = await sendBridgeRequest({
        type: companion.protocol.getTaskStatusMessage,
        submissionId,
      });
      if (submission?.status === "submitted") {
        return submission.status;
      }
      if (submission?.status === "ready_for_review") {
        return submission.status;
      }
      if (submission?.status === "failed") {
        throw new Error(submission.error || "Task submission failed");
      }
      if (submission?.status === "interrupted") {
        throw new Error(submission.error || "The bridge restarted. Check Codex before retrying.");
      }
    }
    throw new Error("Codex submission did not finish within 220 seconds");
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

    try {
      const { submission } = await sendBridgeRequest({
        type: companion.protocol.submitTaskMessage,
        jobUrl,
      });
      if (!submission?.id) {
        throw new Error("The local bridge did not return a submission ID");
      }
      const status = await waitForCompletion(submission.id);
      showToast(
        status === "submitted"
          ? "CV Fit Advisor task submitted."
          : "CV Fit Advisor draft is ready—check 6.1 Sol, Medium, and Fast in Codex, then send it.",
      );
    } catch (error) {
      showToast(
        `Couldn’t confirm the CV Fit Advisor submission. Check Codex before retrying: ${error.message}`,
        "error",
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

  companion.submissions.submit = submit;
})();
