(() => {
  const companion = globalThis.jobSearchCompanion;
  const contract = globalThis.jobSearchContracts.jobAnalyses;
  const keys = globalThis.jobSearchContracts.jobStorageKeys;
  const records = new Map();
  let pending = [];
  const applyRecord = (key, record) => {
    if (key === contract.pendingKey) {
      pending = Array.isArray(record) ? record.filter(contract.isPendingRecord) : [];
      return true;
    }
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
    isAnalysing: (jobUrl) => pending.some((record) => contract.keyFor(record.jobUrl) === contract.keyFor(jobUrl)
      && Date.now() - Date.parse(record.startedAt) < 24 * 60 * 60_000),
    subscribe,
  });
})();
