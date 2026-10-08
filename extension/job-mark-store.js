(() => {
  const companion = globalThis.jobSearchCompanion;
  const timestamps = { applied: "appliedAt", unsuitable: "unsuitableAt" };

  companion.jobMarks.createStore = () => {
    const records = new Map();
    const pendingWrites = new Set();
    const listeners = new Set();
    // Preserve saved record keys: changing these would discard existing marks.
    const keyFor = (jobUrl, kind) => {
      const normalized = companion.jobs.jobUrlFromPageUrl(jobUrl);
      if (!normalized) throw new Error("Couldn’t identify this job.");
      const url = new URL(normalized);
      const id = url.searchParams.get("jk") || url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
      return `${kind}-job:${url.hostname.includes("linkedin") ? "linkedin" : "indeed"}:${id}`;
    };
    const readRecord = (key, value) => {
      const kind = Object.keys(timestamps).find((kind) => key.startsWith(`${kind}-job:`));
      if (!kind) return;
      if (typeof value?.[timestamps[kind]] === "string") records.set(key, value);
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
      isMarked: (jobUrl, kind) => Boolean(records.get(keyFor(jobUrl, kind))?.[timestamps[kind]]),
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
          const marked = !stored[key]?.[timestamps[kind]];
          if (marked) {
            const record = {
              jobUrl: companion.jobs.jobUrlFromPageUrl(jobUrl),
              [timestamps[kind]]: new Date().toISOString(),
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
