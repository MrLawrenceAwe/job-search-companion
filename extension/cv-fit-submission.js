(() => {
  const companion = globalThis.jobSearchCompanion;
  const { showToast } = companion;
  const messages = globalThis.jobSearchContracts.messages;
  const { statuses } = globalThis.jobSearchContracts.cvFitSubmissions;

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

  let submissionInProgress = false;

  const { waitForSubmissionResult } = globalThis.jobSearchCvFitClient.createClient(sendBridgeRequest);

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
      showToast(globalThis.jobSearchCvFitClient.resultMessage(status), status === statuses.unconfirmed ? "warning" : undefined);
    } catch (error) {
      const { message, kind } = globalThis.jobSearchCvFitClient.failureMessage(error, accepted);
      showToast(message, kind);
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
