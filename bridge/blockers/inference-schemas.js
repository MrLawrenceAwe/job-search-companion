const requirementSchema = (category, necessity, evidence, explanationType, factIds) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: category },
    necessity: { type: "string", enum: necessity },
    evidence: { type: "string", enum: evidence },
    requirementQuote: { type: "string", minLength: 1, maxLength: 2000 },
    explanation: explanationType === "string" ? { type: "string", minLength: 1, maxLength: 2000 } : { type: "null" },
    suggestedChallenge: explanationType === "string" ? { type: "string", minLength: 1, maxLength: 300 } : { type: "null" },
    evidenceFactIds: {
      type: "array",
      items: { type: "string", ...(factIds ? { enum: factIds } : {}) },
      ...(evidence[0] === "missing" ? { maxItems: 0 } : { minItems: 1 }),
    },
  },
  required: ["category", "necessity", "evidence", "requirementQuote", "explanation", "suggestedChallenge", "evidenceFactIds"],
});
// Missing evidence cannot cite facts; every other classification needs known facts.
const entryVariants = (category, necessity, evidence, explanationType, factIds) => [
  ...(evidence.includes("missing") ? [requirementSchema(category, necessity, ["missing"], explanationType, factIds)] : []),
  ...(evidence.some((value) => value !== "missing")
    ? [requirementSchema(category, necessity, evidence.filter((value) => value !== "missing"), explanationType, factIds)] : []),
];

export const createRequirementInventorySchema = (factIds) => ({
  type: "object",
  additionalProperties: false,
  properties: { requirements: { type: "array", maxItems: 60, items: { anyOf: [
    ...entryVariants(["eligibility"], ["mandatory"], ["incompatible", "missing", "conflicting"], "string", factIds),
    ...entryVariants(["work_arrangement"], ["mandatory"], ["incompatible"], "string", factIds),
    ...entryVariants(["eligibility", "work_arrangement"], ["mandatory"], ["supported"], "null", factIds),
    ...entryVariants(["work_arrangement"], ["mandatory"], ["missing", "conflicting"], "null", factIds),
    ...entryVariants(["eligibility", "work_arrangement"], ["unclear", "preferred", "excluded"], ["supported", "incompatible", "missing", "conflicting"], "null", factIds),
  ] } } },
  required: ["requirements"],
});

export const requirementInventorySchema = createRequirementInventorySchema();

export const createChallengeReviewSchema = (factIds) => {
  const inventory = createRequirementInventorySchema(factIds);
  return {
    ...inventory,
    properties: {
      ...inventory.properties,
      challengeResponse: { type: "string" },
      challengeAccepted: { type: "boolean" },
      profileUpdates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string" },
            replacesFactIds: { type: "array", items: { type: "string" } },
          },
          required: ["text", "replacesFactIds"],
        },
      },
    },
    required: ["requirements", "challengeResponse", "challengeAccepted", "profileUpdates"],
  };
};
