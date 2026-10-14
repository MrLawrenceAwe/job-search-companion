// Shared by classic Chrome scripts and the Node bridge via shared/contracts.js.
(() => {
  const labels = Object.freeze({
    blocker: "Potential blocker",
    no_blockers_found: "No blockers found",
  });
  const contract = {
    version: 14,
    retentionMs: 30 * 86400_000,
    maximumRecords: 300,
    storagePrefix: "blocker-result:",
    labels,
    getRemainingFindings(record) {
      return record.findings.filter((finding) => !record.overriddenRequirementQuotes?.includes(finding.requirementQuote));
    },
    canOverrideFinding(record, requirementQuote) {
      const normalize = (quote) => typeof quote === "string" ? quote.replace(/\s+/g, " ").trim() : null;
      return record.challengeReview?.accepted === false &&
        normalize(record.challengeReview.requirementQuote) === normalize(requirementQuote) &&
        record.findings.some((finding) => finding.requirementQuote === requirementQuote);
    },
    isRetainableResult(record, now = Date.now()) {
      return Boolean(
        record &&
          record.checkerVersion === contract.version &&
          Object.hasOwn(labels, record.outcome) &&
          Array.isArray(record.findings) &&
          record.findings.every((finding) => finding?.kind === "blocker" &&
            typeof finding.suggestedChallenge === "string" &&
            finding.suggestedChallenge.trim().length > 0 && finding.suggestedChallenge.length <= 300 &&
            finding.suggestedChallenge.trim().split(/\s+/).length <= 25) &&
          (record.overriddenRequirementQuotes === undefined ||
            (Array.isArray(record.overriddenRequirementQuotes) &&
              new Set(record.overriddenRequirementQuotes).size === record.overriddenRequirementQuotes.length &&
              record.overriddenRequirementQuotes.every((quote) => typeof quote === "string" &&
                record.findings.some((finding) => finding.requirementQuote === quote)))) &&
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
