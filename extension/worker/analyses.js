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
        if (!Array.isArray(body.pending) || !body.pending.every(contract.isPendingRecord))
          throw new Error("Invalid pending analysis records");
        const values = { [contract.pendingKey]: body.pending };
        for (const record of body.analyses) {
          if (!contract.isRecord(record)) throw new Error("Invalid analysis record");
          values[contract.keyFor(record.jobUrl)] = record;
        }
        const keys = globalThis.jobSearchContracts.jobStorageKeys;
        const unsuitableKeys = Object.values(values).filter((record) => record.verdict === "do not apply yet")
          .map((record) => keys.forUrl("unsuitable", record.jobUrl));
        const prior = await chrome.storage.local.get([...Object.keys(values), ...unsuitableKeys]);
        const changed = Object.fromEntries(Object.entries(values).filter(([key, record]) =>
          JSON.stringify(prior[key]) !== JSON.stringify(record)));
        for (const [key, record] of Object.entries(changed)) {
          if (record.verdict !== "do not apply yet") continue;
          // A repeated sync must not undo a user's later decision to clear the mark.
          const previous = prior[key];
          if (previous?.verdict === record.verdict && previous.threadId === record.threadId
            && previous.analyzedAt === record.analyzedAt) continue;
          const unsuitableKey = keys.forUrl("unsuitable", record.jobUrl);
          if (!prior[unsuitableKey]) changed[unsuitableKey] = {
            jobUrl: record.jobUrl, unsuitableAt: new Date().toISOString(),
          };
        }
        if (Object.keys(changed).length) await chrome.storage.local.set(changed);
        return { ok: true };
      })().finally(() => { analysisSync = null; });
      return analysisSync;
    };

    const open = async (jobUrl) => {
      const { response, body } = await requestBridgeJson(`${bridgeConfig.bridgeOrigin}/analyses/open`, {
        method: "POST", body: { jobUrl },
      });
      if (!response.ok || !body?.ok) throw new Error(body?.error || "Couldn’t open the analysis");
      return { ok: true };
    };

    const handleAnalysisMessage = (message, sender, sendResponse) => {
      if (![messages.syncJobAnalyses, messages.openJobAnalysis].includes(message?.type)) return false;
      if (!isJobSiteSender(sender, ["indeed", "linkedin"])) {
        sendResponse({ ok: false, error: "Analysis request is not allowed" });
        return false;
      }
      const action = message.type === messages.syncJobAnalyses ? syncJobAnalyses()
        : open(message.jobUrl);
      action.then(sendResponse, (error) => sendResponse({ ok: false, error: error.message }));
      return true;
    };

    return { handleMessage: handleAnalysisMessage, sync: syncJobAnalyses, open };
  };
})();
