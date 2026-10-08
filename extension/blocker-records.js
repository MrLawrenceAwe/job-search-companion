(() => {
  const {
    storagePrefix: PREFIX,
    isValidRecord: validRecord,
    maximumRecords,
  } = globalThis.jobSearchContracts.blockers;
  globalThis.jobSearchCompanion.blockers.createRecordStore = () => {
    const records = new Map();
    const saveResult = async (result) => {
      records.set(result.jobId, result);
      await chrome.storage.local.set({ [`${PREFIX}${result.jobId}`]: result });
      const expired = [...records].filter(([, r]) => !validRecord(r)).map(([id]) => id);
      const surplus = [...records]
        .sort((a, b) => Date.parse(b[1].checkedAt) - Date.parse(a[1].checkedAt))
        .slice(maximumRecords)
        .map(([id]) => id);
      const remove = [...new Set([...expired, ...surplus])];
      for (const id of remove) records.delete(id);
      if (remove.length) await chrome.storage.local.remove(remove.map((id) => PREFIX + id));
    };
    return {
      records,
      saveResult,
      async loadRecords() {
        const stored = await chrome.storage.local.get(null);
        for (const [key, value] of Object.entries(stored)) {
          if (key.startsWith(PREFIX) && validRecord(value))
            records.set(key.slice(PREFIX.length), value);
        }
      },
    };
  };
})();
