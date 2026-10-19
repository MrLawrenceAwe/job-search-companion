(() => {
  const { isUuid } = globalThis.jobSearchContracts.identifiers;
  const verdicts = Object.freeze([
    "use as-is", "edit the CV", "tailor into a role-specific CV", "create a new CV",
    "no suitable base CV", "not enough information", "do not apply yet",
  ]);
  const colorFor = (verdict) => ({
    "use as-is": "green", "edit the CV": "yellow",
    "no suitable base CV": "red", "do not apply yet": "red",
  }[verdict] || "blue");
  const keyFor = (jobUrl) => globalThis.jobSearchContracts.jobStorageKeys.forUrl("analysis", jobUrl);
  const isRecord = (record) => Boolean(record && isUuid(record.threadId)
    && typeof record.analyzedAt === "string" && Number.isFinite(Date.parse(record.analyzedAt))
    && (record.verdict === undefined || verdicts.includes(record.verdict)));
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.jobAnalyses = Object.freeze({
    keyFor, isRecord, verdicts, colorFor,
    isVerdict: (verdict) => verdicts.includes(verdict),
    linkFor: (id) => {
      if (!isUuid(id)) throw new Error("Invalid Codex chat ID");
      return `codex://threads/${id}?hostId=local`;
    },
  });
})();
