(() => {
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.cvFitSettings = Object.freeze([
    Object.freeze({ category: "Model", label: "6.2 Sol", match: "exact" }),
    Object.freeze({ category: "Effort", label: "Medium", match: "exact" }),
    Object.freeze({ category: "Speed", label: "Standard", match: "prefix" }),
  ]);
})();
