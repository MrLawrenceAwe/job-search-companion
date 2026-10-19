(() => {
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.messages = Object.freeze({
    submitCvFitTask: "SUBMIT_CV_FIT_TASK",
    getCvFitSubmissionStatus: "GET_CV_FIT_SUBMISSION_STATUS",
    syncJobAnalyses: "SYNC_JOB_ANALYSES",
    syncIndeedApplications: "SYNC_INDEED_APPLICATIONS",
    getIndeedJobTitle: "GET_INDEED_JOB_TITLE",
    getIndeedJobAvailability: "GET_INDEED_JOB_AVAILABILITY",
    openJobAnalysis: "OPEN_JOB_ANALYSIS",
    indeedDescription: "jsc-indeed-description-v1",
    requestInitialDescription: "jsc-request-initial-description-v1",
    blockerRequest: "BLOCKER_REQUEST",
  });
})();
