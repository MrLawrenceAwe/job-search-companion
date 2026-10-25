(() => {
  const companion = globalThis.jobSearchCompanion;
  const { timestampFields, isRecord } = globalThis.jobSearchContracts.jobMarks;

  const records = new Map();
  const pendingWrites = new Set();
  // Preserve saved record keys: changing these would discard existing marks.
  const keyFor = (jobUrl, kind) => {
    const normalized = companion.jobs.jobUrlFromPageUrl(jobUrl);
    if (!normalized) throw new Error("Couldn’t identify this job.");
    const { platform, id } = globalThis.jobSearchContracts.jobUrls.identityFromUrl(new URL(normalized));
    return globalThis.jobSearchContracts.jobStorageKeys.forJob(kind, { platform, id });
  };
  const applyRecord = (key, value) => {
    const kind = globalThis.jobSearchContracts.jobStorageKeys.parse(key)?.kind;
    if (!Object.hasOwn(timestampFields, kind)) return;
    if (isRecord(kind, value)) records.set(key, value);
    else records.delete(key);
    return true;
  };
  const { ready, subscribe } = globalThis.jobSearchStorage.observe({
    applyRecord, errorMessage: "Job record update failed:",
  });
  companion.jobMarkStore = Object.freeze({
    ready,
    isMarked: (jobUrl, kind) => isRecord(kind, records.get(keyFor(jobUrl, kind))),
    isPending: (jobUrl, kind) => pendingWrites.has(keyFor(jobUrl, kind)),
    subscribe,
    async toggle(jobUrl, kind) {
      const key = keyFor(jobUrl, kind);
      if (pendingWrites.has(key)) return null;
      pendingWrites.add(key);
      try {
        await ready;
        const stored = await chrome.storage.local.get(key);
        const marked = !isRecord(kind, stored[key]);
        if (marked) {
          const record = {
            jobUrl: companion.jobs.jobUrlFromPageUrl(jobUrl),
            [timestampFields[kind]]: new Date().toISOString(),
          };
          await chrome.storage.local.set({ [key]: record });
          records.set(key, record);
        } else {
          await chrome.storage.local.remove(key);
          records.delete(key);
        }
        return marked;
      } finally {
        pendingWrites.delete(key);
      }
    },
  });
})();
