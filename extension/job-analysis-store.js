(() => {
  const companion = globalThis.jobSearchCompanion;
  const contract = globalThis.jobSearchContracts.jobAnalyses;
  const keys = globalThis.jobSearchContracts.jobStorageKeys;
  const records = new Map();
  const applyRecord = (key, record) => {
    if (keys.parse(key)?.kind !== "analysis") return false;
    if (contract.isRecord(record)) records.set(key, record);
    else records.delete(key);
    return true;
  };
  const { ready, subscribe } = globalThis.jobSearchStorage.observe({
    applyRecord, errorMessage: "Analysis record update failed:",
  });
  companion.jobAnalysisStore = Object.freeze({
    ready,
    get: (jobUrl) => records.get(contract.keyFor(jobUrl)),
    entries: () => records.entries(),
    subscribe,
  });
})();
