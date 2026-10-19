(() => {
  globalThis.jobSearchWorkerModules ??= {};
  globalThis.jobSearchWorkerModules.createCvFitHandler = ({ bridgeConfig, requestBridgeJson }) => {
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
      try {
        const { response, body: parsedBody } = await requestBridgeJson(endpoint, {
          method: isStart ? "POST" : "GET",
          body: { jobUrl: message.jobUrl },
        });
        const body = parsedBody || {};
        return response.ok && body.ok
          ? { ok: true, ...(body.submission ? { submission: body.submission } : {}) }
          : { ok: false, error: body.error || `Request failed with status ${response.status}` };
      } catch (error) {
        return {
          ok: false,
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
      if (!bridgeConfig.bridgeToken) {
        sendResponse({
          ok: false,
          error: "Bridge token is not configured in extension/local-config.js",
        });
        return false;
      }
      requestCvFitSubmission(message).then(sendResponse, (error) => {
        sendResponse({ ok: false, error: error.message });
      });
      return true;
    };

    return handleCvFitMessage;
  };
})();
