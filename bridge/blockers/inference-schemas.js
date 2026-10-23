import { blockerContract } from "../../shared/contracts.js";
import { requirementClasses } from "./requirement-policy.js";

const { suggestedChallengeLimits, limits } = blockerContract;

const requirementSchema = ({ categories, necessities, evidenceStates, producesFinding = false, factIds }) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: categories },
    necessity: { type: "string", enum: necessities },
    evidence: { type: "string", enum: evidenceStates },
    requirementQuote: { type: "string", minLength: 1, maxLength: limits.maximumQuoteCharacters },
    explanation: producesFinding ? { type: "string", minLength: 1, maxLength: limits.maximumExplanationCharacters } : { type: "null" },
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
      maxItems: limits.maximumRequirements,
      items: { anyOf: requirementClasses.flatMap((classification) =>
        entryVariants({ ...classification, factIds })),
      },
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
