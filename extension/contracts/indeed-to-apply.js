// Shared eligibility and exclusion validation for the list and reminder cards.
(() => {
  const contracts = globalThis.jobSearchContracts;
  const isExclusionRecord = (kind, record) => {
    if (["applied", "unsuitable"].includes(kind)) return contracts.jobMarks.isRecord(kind, record);
    if (kind === "indeedAvailability")
      return contracts.indeedAvailability.isRecord(record) && record.status === "expired";
    const timestamp = { indeedApplied: "detectedAt", indeedDismissed: "dismissedAt" }[kind];
    return Boolean(timestamp && typeof record?.[timestamp] === "string");
  };
  contracts.indeedToApply = Object.freeze({
    isExclusionRecord,
    isExcluded: (identity, readRecord) =>
      ["applied", "unsuitable", "indeedApplied", "indeedDismissed", "indeedAvailability"].some(
        (kind) => isExclusionRecord(kind, readRecord(contracts.jobStorageKeys.forJob(kind, identity))),
      ),
    isEligible: ({ platform, analysis, excluded }) => platform === "indeed"
      && contracts.jobAnalyses.isRecord(analysis)
      && contracts.jobAnalyses.isToApplyVerdict(analysis.verdict) && !excluded,
  });
})();
