// Preserve persisted timestamp names so existing manual marks remain accessible.
(() => {
  const timestampFields = Object.freeze({ applied: "appliedAt", unsuitable: "unsuitableAt" });
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.jobMarks = Object.freeze({
    timestampFields,
    isRecord(kind, record) {
      return Object.hasOwn(timestampFields, kind) &&
        typeof record?.[timestampFields[kind]] === "string" && Boolean(record[timestampFields[kind]]);
    },
  });
})();
