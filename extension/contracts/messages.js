(() => {
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.messages = Object.freeze({
    submitCvFitTask: "SUBMIT_CV_FIT_TASK",
    getCvFitTaskStatus: "GET_CV_FIT_TASK_STATUS",
    indeedDescription: "jsc-indeed-description-v1",
    requestInitialDescription: "jsc-request-initial-description-v1",
    blockerRequest: "BLOCKER_REQUEST",
    openBlockerSettings: "OPEN_BLOCKER_SETTINGS",
  });
})();
