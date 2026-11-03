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
  const isExcludedFromRefresh = (readRecord) =>
    ["applied", "unsuitable", "indeedApplied", "indeedDismissed"].some(
      (kind) => isExclusionRecord(kind, readRecord(kind)),
    );
  contracts.indeedToApply = Object.freeze({
    isExcludedFromRefresh,
    isExcludedFromDisplay: (readRecord) => isExcludedFromRefresh(readRecord)
      || isExclusionRecord("indeedAvailability", readRecord("indeedAvailability")),
    isEligible: ({ platform, analysis, excluded }) => platform === "indeed"
      && contracts.jobAnalyses.isRecord(analysis)
      && contracts.jobAnalyses.isToApplyVerdict(analysis.verdict) && !excluded,
  });
})();
