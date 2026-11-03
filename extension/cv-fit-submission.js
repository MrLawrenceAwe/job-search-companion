(() => {
  const companion = globalThis.jobSearchCompanion;
  const { showToast } = companion;
  const messages = globalThis.jobSearchContracts.messages;
  const client = globalThis.jobSearchCvFitClient;
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
        } else {
          resolve(response);
        }
      });
    });

  let submissionInProgress = false;

  const { waitForSubmissionResult } = client.createClient(sendBridgeRequest);

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
      const submission = client.readSubmission(await sendBridgeRequest({
        type: messages.submitCvFitTask,
        jobUrl,
      }), { starting: true });
      accepted = true;
      const status = await waitForSubmissionResult(submission.id);
      showToast(client.resultMessage(status), status === statuses.unconfirmed ? "warning" : undefined);
    } catch (error) {
      const { message, kind } = client.failureMessage(error, accepted);
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
