(() => {
  const { isUuid } = globalThis.jobSearchContracts.identifiers;
  const verdictDetails = Object.freeze(Object.fromEntries([
    ["use as-is", { label: "Use as is", color: "green", toApply: true }],
    ["edit the CV", { label: "Edit CV", color: "yellow", toApply: true }],
    ["tailor into a role-specific CV", { label: "Tailor into a role-specific CV", color: "blue", toApply: false }],
    ["create a new CV", { label: "Create a new CV", color: "blue", toApply: false }],
    ["no suitable base CV", { label: "No suitable base CV", color: "red", toApply: false }],
    ["not enough information", { label: "Not enough information", color: "blue", toApply: false }],
    ["do not apply yet", { label: "Do not apply yet", color: "red", toApply: false }],
  ].map(([verdict, details]) => [verdict, Object.freeze(details)])));
  const verdicts = Object.freeze(Object.keys(verdictDetails));
  const detailsFor = (verdict) => Object.hasOwn(verdictDetails, verdict) ? verdictDetails[verdict] : null;
  const colorFor = (verdict) => detailsFor(verdict)?.color || "blue";
  const labelFor = (verdict) => detailsFor(verdict)?.label || "Verdict not recorded";
  const isToApplyVerdict = (verdict) => detailsFor(verdict)?.toApply === true;
  const toApplyVerdicts = Object.freeze(verdicts.filter(isToApplyVerdict));
  const keyFor = (jobUrl) => globalThis.jobSearchContracts.jobStorageKeys.forUrl("analysis", jobUrl);
  const isRecord = (record) => Boolean(record && isUuid(record.threadId)
    && typeof record.analyzedAt === "string" && Number.isFinite(Date.parse(record.analyzedAt))
    && (record.verdict === undefined || verdicts.includes(record.verdict)));
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.jobAnalyses = Object.freeze({
    keyFor, isRecord, verdicts, colorFor, labelFor, isToApplyVerdict, toApplyVerdicts,
    isVerdict: (verdict) => verdicts.includes(verdict),
    linkFor: (id) => {
      if (!isUuid(id)) throw new Error("Invalid Codex chat ID");
      return `codex://threads/${id}?hostId=local`;
    },
  });
})();
