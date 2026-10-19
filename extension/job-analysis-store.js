(() => {
  const companion = globalThis.jobSearchCompanion;
  const contract = globalThis.jobSearchContracts.jobAnalyses;
  const keys = globalThis.jobSearchContracts.jobStorageKeys;
  const records = new Map();
  const listeners = new Set();
  const read = (key, record) => {
    if (keys.parse(key)?.kind !== "analysis") return false;
    if (contract.isRecord(record)) records.set(key, record);
    else records.delete(key);
    return true;
  };
  const ready = chrome.storage.local.get(null).then((stored) => {
    for (const [key, record] of Object.entries(stored)) read(key, record);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    // Apply notifications after the initial snapshot so newer changes win.
    void ready.then(() => {
      let changed = false;
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (read(key, newValue)) changed = true;
      }
      if (changed) for (const listener of listeners) listener();
    }).catch((error) => console.debug("Analysis record update failed:", error));
  });
  companion.jobAnalysisStore = Object.freeze({
    ready,
    get: (jobUrl) => records.get(contract.keyFor(jobUrl)),
    entries: () => records.entries(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
})();
