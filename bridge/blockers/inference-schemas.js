import { blockerContract } from "../../shared/contracts.js";

const { suggestedChallengeLimits } = blockerContract;

const requirementSchema = ({ categories, necessities, evidenceStates, producesFinding = false, factIds }) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: categories },
    necessity: { type: "string", enum: necessities },
    evidence: { type: "string", enum: evidenceStates },
    requirementQuote: { type: "string", minLength: 1, maxLength: 2000 },
    explanation: producesFinding ? { type: "string", minLength: 1, maxLength: 2000 } : { type: "null" },
    suggestedChallenge: producesFinding ? { type: "string", minLength: 1, maxLength: suggestedChallengeLimits.maximumCharacters } : { type: "null" },
    evidenceFactIds: {
      type: "array",
      items: { type: "string", ...(factIds ? { enum: factIds } : {}) },
      ...(evidenceStates[0] === "missing" ? { maxItems: 0 } : { minItems: 1 }),
    },
  },
  required: ["category", "necessity", "evidence", "requirementQuote", "explanation", "suggestedChallenge", "evidenceFactIds"],
});
// Missing evidence cannot cite facts; every other classification needs known facts.
const entryVariants = ({ evidenceStates, ...options }) => {
  const referencedStates = evidenceStates.filter((value) => value !== "missing");
  return [
    ...(evidenceStates.includes("missing") ? [requirementSchema({ ...options, evidenceStates: ["missing"] })] : []),
    ...(referencedStates.length ? [requirementSchema({ ...options, evidenceStates: referencedStates })] : []),
  ];
};

export const createRequirementInventorySchema = (factIds) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    requirements: {
      type: "array",
      maxItems: 60,
      items: { anyOf: [
        ...entryVariants({
          categories: ["eligibility"], necessities: ["mandatory"],
          evidenceStates: ["incompatible", "missing", "conflicting"], producesFinding: true, factIds,
        }),
        ...entryVariants({
          categories: ["work_arrangement"], necessities: ["mandatory"],
          evidenceStates: ["incompatible"], producesFinding: true, factIds,
        }),
        ...entryVariants({
          categories: ["eligibility", "work_arrangement"], necessities: ["mandatory"],
          evidenceStates: ["supported"], factIds,
        }),
        ...entryVariants({
          categories: ["work_arrangement"], necessities: ["mandatory"],
          evidenceStates: ["missing", "conflicting"], factIds,
        }),
        ...entryVariants({
          categories: ["eligibility", "work_arrangement"], necessities: ["unclear", "preferred", "excluded"],
          evidenceStates: ["supported", "incompatible", "missing", "conflicting"], factIds,
        }),
      ] },
    },
  },
  required: ["requirements"],
});

export const requirementInventorySchema = createRequirementInventorySchema();

export const createChallengeReviewSchema = (factIds) => {
  const inventory = createRequirementInventorySchema(factIds);
  return {
    ...inventory,
    properties: {
      ...inventory.properties,
      challengeResponse: { type: "string", description: "Reply only about blockerChallenge.requirementQuote and the candidate clarification. If accepted, return only Challenge accepted. If rejected, explain why this finding remains without discussing other blockers or challenges." },
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
