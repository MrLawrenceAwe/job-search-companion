// Shared persisted states and native helper results for CV Fit task submission.
(() => {
  const statuses = Object.freeze({
    submitting: "submitting",
    submitted: "submitted",
    readyForReview: "ready_for_review",
    failed: "failed",
    interrupted: "interrupted",
  });
  const persistedStatuses = Object.freeze(Object.values(statuses));
  const helperResults = Object.freeze([statuses.submitted, statuses.readyForReview]);
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.cvFitSubmissions = Object.freeze({
    statuses,
    persistedStatuses,
    helperResults,
  });
})();
