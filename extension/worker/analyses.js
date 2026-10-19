(() => {
  globalThis.jobSearchWorkerModules ??= {};
  globalThis.jobSearchWorkerModules.createAnalysisService = ({ bridgeConfig, requestBridgeJson, isJobSiteSender }) => {
    const messages = globalThis.jobSearchContracts.messages;
    let analysisSync = null;
    const syncJobAnalyses = () => {
      if (analysisSync) return analysisSync;
      analysisSync = (async () => {
        if (!bridgeConfig.bridgeToken) throw new Error("Local bridge is not configured");
        const { response, body } = await requestBridgeJson(`${bridgeConfig.bridgeOrigin}/analyses`, { method: "GET" });
        if (!response.ok || !body?.ok || !Array.isArray(body.analyses)) throw new Error("Analysis records unavailable");
        const contract = globalThis.jobSearchContracts.jobAnalyses;
        const values = {};
        for (const record of body.analyses) {
          if (!contract.isRecord(record)) throw new Error("Invalid analysis record");
          values[contract.keyFor(record.jobUrl)] = record;
        }
        const prior = await chrome.storage.local.get(Object.keys(values));
        const changed = Object.fromEntries(Object.entries(values).filter(([key, record]) =>
          JSON.stringify(prior[key]) !== JSON.stringify(record)));
        if (Object.keys(changed).length) await chrome.storage.local.set(changed);
        return { ok: true };
      })().finally(() => { analysisSync = null; });
      return analysisSync;
    };

    const handleAnalysisMessage = (message, sender, sendResponse) => {
      if (![messages.syncJobAnalyses, messages.openJobAnalysis].includes(message?.type)) return false;
      if (!isJobSiteSender(sender, ["indeed", "linkedin"])) {
        sendResponse({ ok: false, error: "Analysis request is not allowed" });
        return false;
      }
      const action = message.type === messages.syncJobAnalyses ? syncJobAnalyses()
        : requestBridgeJson(`${bridgeConfig.bridgeOrigin}/analyses/open`, {
          method: "POST", body: { jobUrl: message.jobUrl },
        }).then(({ response, body }) => {
          if (!response.ok || !body?.ok) throw new Error(body?.error || "Couldn’t open the analysis");
          return { ok: true };
        });
      action.then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
      return true;
    };

    return { handleMessage: handleAnalysisMessage, sync: syncJobAnalyses };
  };
})();
