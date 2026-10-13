// Shared model settings for requirement checking and CV indexing.
(() => {
  const defaultReasoningEffort = "medium";
  const supportsReasoningSelection = (model) => model === "gpt-6-luna";
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.inferenceSettings = Object.freeze({
    defaultReasoningEffort,
    supportsReasoningSelection,
    reasoningForModel(model, effort) {
      return supportsReasoningSelection(model) ? effort : null;
    },
    inferenceOptions(model, effort = defaultReasoningEffort) {
      return supportsReasoningSelection(model)
        ? { service_tier: "priority", reasoning: { effort: effort || defaultReasoningEffort } }
        : {};
    },
  });
})();
