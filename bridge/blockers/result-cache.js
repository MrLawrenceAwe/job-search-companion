import { join } from "node:path";
import { openPrivateStore } from "./private-store.js";
import { blockerContract } from "../../shared/contracts.js";

export const openResultCache = async (directory) => {
  const store = await openPrivateStore(join(directory, "cache.json"), {
    results: {},
  });
  const prune = () => {
    const entries = Object.entries(store.value.results)
      .filter(([, record]) => blockerContract.isValidRecord(record))
      .sort((a, b) => Date.parse(b[1].checkedAt) - Date.parse(a[1].checkedAt));
    store.value.results = Object.fromEntries(entries.slice(0, blockerContract.maximumRecords));
  };
  prune();
  return {
    get(key) {
      prune();
      return store.value.results[key];
    },
    async put(key, record) {
      store.value.results[key] = record;
      prune();
      await store.save();
    },
    restore(key, pendingRecord, previousRecord) {
      if (store.value.results[key] !== pendingRecord) return;
      if (previousRecord) store.value.results[key] = previousRecord;
      else delete store.value.results[key];
    },
    async clear() {
      store.value.results = {};
      await store.save();
    },
  };
};
