(() => {
  globalThis.jobSearchWorkerModules ??= {};
  globalThis.jobSearchWorkerModules.createCvFitService = ({ bridgeConfig, requestBridgeJson }) => {
    const messages = globalThis.jobSearchContracts.messages;
    const submissionsEndpoint = `${bridgeConfig.bridgeOrigin}/cv-fit-submissions`;
    const requestCvFitSubmission = async (message) => {
      const isStart = message.type === messages.submitCvFitTask;
      if (!isStart && !message.submissionId) {
        return { ok: false, error: "Submission ID is missing" };
      }
      const endpoint = isStart
        ? submissionsEndpoint
        : `${submissionsEndpoint}/${encodeURIComponent(message.submissionId)}`;
      if (!bridgeConfig.bridgeToken) return {
        ok: false,
        error: "Install the local bridge to enable CV-fit analysis. See the project setup guide.",
      };
      try {
        const { response, body: parsedBody } = await requestBridgeJson(endpoint, {
          method: isStart ? "POST" : "GET",
          body: { jobUrl: message.jobUrl },
        });
        const body = parsedBody || {};
        if (!response.ok || body.ok === false)
          return { ok: false, error: body.error || `Request failed with status ${response.status}` };
        if (!body.ok || typeof body.submission?.id !== "string" || !body.submission.id)
          return { ok: false, ...(isStart ? { uncertain: true } : {}), error: "The local bridge did not return a submission ID" };
        return { ok: true, submission: body.submission };
      } catch (error) {
        return {
          ok: false,
          ...(isStart ? { uncertain: true } : {}),
          error: error.name === "AbortError"
            ? "The local bridge did not respond within 10 seconds"
            : error.message,
        };
      }
    };

    const handleCvFitMessage = (message, _sender, sendResponse) => {
      if (
        ![messages.submitCvFitTask, messages.getCvFitSubmissionStatus].includes(
          message?.type,
        )
      ) {
        return false;
      }
      requestCvFitSubmission(message).then(sendResponse, (error) => {
        sendResponse({ ok: false, error: error.message });
      });
      return true;
    };

    return {
      handleMessage: handleCvFitMessage,
      start: (jobUrl) => requestCvFitSubmission({ type: messages.submitCvFitTask, jobUrl }),
    };
  };
})();
