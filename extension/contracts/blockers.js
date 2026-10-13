// Shared by classic Chrome scripts and the Node bridge via shared/contracts.js.
(() => {
  const labels = Object.freeze({
    blocker: "Potential blocker",
    no_blockers_found: "No blockers found",
  });
  const contract = {
    version: 13,
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
          record.findings.every((finding) => finding?.kind === "blocker") &&
          (record.outcome === "blocker" ? record.findings.length > 0 : record.findings.length === 0) &&
          typeof record.jobId === "string" &&
          typeof record.descriptionHash === "string" &&
          typeof record.evidenceHash === "string" &&
          typeof record.model === "string" &&
          Number.isFinite(Date.parse(record.checkedAt)) &&
          now - Date.parse(record.checkedAt) < contract.retentionMs,
      );
    },
  };
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.blockers = Object.freeze(contract);
})();
