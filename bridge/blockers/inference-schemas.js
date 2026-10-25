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
    explanation: producesFinding ? { type: "string", minLength: 1, maxLength: limits.maximumExplanationCharacters,
      description: `Explain the evidence gap or incompatibility in at most ${limits.maximumExplanationWords} words.` } : { type: "null" },
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
  const editableFactIds = factIds.filter((id) => id.startsWith("F"));
  return {
    ...inventory,
    properties: {
      ...inventory.properties,
      challengeResponse: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: limits.maximumChallengeResponseCharacters,
        pattern: "\\S",
        description: `Null when accepted. When rejected, explain only why blockerChallenge.requirementQuote remains a blocker, in at most ${limits.maximumChallengeResponseWords} words.`,
      },
      challengeAccepted: { type: "boolean" },
      profileUpdates: {
        type: "array",
        maxItems: limits.maximumProfileUpdates,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string", minLength: 1, maxLength: limits.maximumProfileFactCharacters,
              pattern: "^[^\\r\\n]*\\S[^\\r\\n]*$" },
            replacesFactIds: { type: "array", maxItems: editableFactIds.length,
              items: { type: "string", ...(editableFactIds.length ? { enum: editableFactIds } : {}) } },
          },
          required: ["text", "replacesFactIds"],
        },
      },
    },
    required: ["requirements", "challengeResponse", "challengeAccepted", "profileUpdates"],
  };
};
