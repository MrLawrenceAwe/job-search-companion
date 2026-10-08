// Shared by classic Chrome scripts and the Node bridge via shared/contracts.js.
(() => {
  const labels = Object.freeze({
    clear_blocker: "Confirmed blocker",
    uncertain_requirement: "Uncertain requirement",
    no_blockers_found: "No blockers found",
  });
  const contract = {
    version: 1,
    retentionMs: 30 * 86400_000,
    maximumRecords: 300,
    storagePrefix: "blocker-result:",
    labels,
    isRetainableResult(record, now = Date.now()) {
      return Boolean(
        record &&
          record.checkerVersion === contract.version &&
          Object.hasOwn(labels, record.outcome) &&
          Array.isArray(record.findings) &&
          typeof record.jobId === "string" &&
          typeof record.descriptionHash === "string" &&
          typeof record.profileHash === "string" &&
          typeof record.model === "string" &&
          Number.isFinite(Date.parse(record.checkedAt)) &&
          now - Date.parse(record.checkedAt) < contract.retentionMs,
      );
    },
  };
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.blockers = Object.freeze(contract);
})();
