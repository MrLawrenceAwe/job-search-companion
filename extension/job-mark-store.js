(() => {
  const companion = globalThis.jobSearchCompanion;
  const { timestampFields, isRecord } = globalThis.jobSearchContracts.jobMarks;

  companion.jobMarks.createStore = () => {
    const records = new Map();
    const pendingWrites = new Set();
    const listeners = new Set();
    // Preserve saved record keys: changing these would discard existing marks.
    const keyFor = (jobUrl, kind) => {
      const normalized = companion.jobs.jobUrlFromPageUrl(jobUrl);
      if (!normalized) throw new Error("Couldn’t identify this job.");
      const { platform, id } = globalThis.jobSearchContracts.jobUrls.identityFromUrl(new URL(normalized));
      return globalThis.jobSearchContracts.jobStorageKeys.forJob(kind, { platform, id });
    };
    const readRecord = (key, value) => {
      const kind = globalThis.jobSearchContracts.jobStorageKeys.parse(key)?.kind;
      if (!Object.hasOwn(timestampFields, kind)) return;
      if (isRecord(kind, value)) records.set(key, value);
      else records.delete(key);
    };
    const ready = chrome.storage.local.get(null).then((stored) => {
      for (const [key, value] of Object.entries(stored)) readRecord(key, value);
    });
    // Apply notifications after the initial snapshot so newer changes win.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      void ready.then(() => {
        for (const [key, { newValue }] of Object.entries(changes)) readRecord(key, newValue);
        for (const listener of listeners) listener();
      }).catch((error) => console.debug("Job record update failed:", error));
    });
    return {
      ready,
      isMarked: (jobUrl, kind) => isRecord(kind, records.get(keyFor(jobUrl, kind))),
      isPending: (jobUrl, kind) => pendingWrites.has(keyFor(jobUrl, kind)),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
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
    };
  };
})();
