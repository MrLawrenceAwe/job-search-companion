(() => {
  const { storagePrefix, isRetainableResult, maximumRecords } = globalThis.jobSearchContracts.blockers;

  const createStore = () => {
    const records = new Map();
    const listeners = new Set();
    const notify = (changes) => {
      for (const listener of listeners) listener(changes);
    };
    const applyRecord = (key, value) => {
      const jobId = key.slice(storagePrefix.length);
      const removed = !isRetainableResult(value);
      if (removed) records.delete(jobId);
      else records.set(jobId, value);
      return { jobId, removed };
    };
    const ready = chrome.storage.local.get(null).then((stored) => {
      for (const [key, value] of Object.entries(stored)) {
        if (key.startsWith(storagePrefix)) applyRecord(key, value);
      }
    });
    const onStorageChanged = (changes, area) => {
      if (area !== "local") return;
      // Apply newer notifications after the initial snapshot, including removals.
      void ready.then(() => {
        const recordChanges = Object.entries(changes)
          .filter(([key]) => key.startsWith(storagePrefix))
          .map(([key, { newValue }]) => applyRecord(key, newValue));
        if (recordChanges.length) notify(recordChanges);
      }).catch((error) => console.debug("Blocker record update failed:", error));
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    const removeResults = async (jobIds) => {
      for (const jobId of jobIds) records.delete(jobId);
      if (jobIds.length) await chrome.storage.local.remove(jobIds.map((jobId) => storagePrefix + jobId));
    };
    return {
      ready,
      get: (jobId) => records.get(jobId),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async saveResult(result) {
        await ready;
        const key = storagePrefix + result.jobId;
        // The in-memory map excludes expired records. Prune the persisted
        // snapshot before writing so old findings cannot fill the storage quota.
        const stored = await chrome.storage.local.get(null);
        const retainedKeys = new Set(Object.entries({ ...stored, [key]: result })
          .filter(([key, record]) => key.startsWith(storagePrefix) && isRetainableResult(record))
          .sort(([, left], [, right]) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt))
          .slice(0, maximumRecords)
          .map(([key]) => key));
        await removeResults(Object.keys(stored)
          .filter((key) => key.startsWith(storagePrefix) && !retainedKeys.has(key))
          .map((key) => key.slice(storagePrefix.length)));
        if (!retainedKeys.has(key)) return;
        await chrome.storage.local.set({ [key]: result });
        records.set(result.jobId, result);
      },
      async clear() {
        await ready;
        const stored = await chrome.storage.local.get(null);
        const keys = Object.keys(stored).filter((key) => key.startsWith(storagePrefix));
        records.clear();
        await chrome.storage.local.remove(keys);
      },
    };
  };

  globalThis.jobSearchBlockerResults = Object.freeze({ createStore });
})();
