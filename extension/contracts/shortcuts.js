(() => {
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.shortcuts = Object.freeze({
    submitCvFit: "n",
    nextJob: "j",
    previousJob: "k",
    hideJob: "h",
    undoJobAction: "u",
  });
})();
