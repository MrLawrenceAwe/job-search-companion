// Application policies for requirement checking and CV indexing.
(() => {
  const checkerReasoningEfforts = Object.freeze(["low", "medium"]);
  const defaultReasoningEffort = "medium";
  const indexingReasoningEffort = "medium";
  const reasoningPolicyForModel = (model) => model === "gpt-6-luna" ? "selectable" : "default";
  const processingTierForModel = (model) => model === "gpt-6-luna" ? "priority" : null;
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.inferenceSettings = Object.freeze({
    checkerReasoningEfforts,
    defaultReasoningEffort,
    indexingReasoningEffort,
    reasoningPolicyForModel,
    processingTierForModel,
    reasoningForModel(model, effort) {
      return reasoningPolicyForModel(model) === "selectable" ? effort : null;
    },
    inferenceOptions(model, effort = defaultReasoningEffort) {
      const tier = processingTierForModel(model);
      return {
        ...(tier ? { service_tier: tier } : {}),
        ...(reasoningPolicyForModel(model) === "selectable"
          ? { reasoning: { effort: effort || defaultReasoningEffort } }
          : {}),
      };
    },
  });
})();
