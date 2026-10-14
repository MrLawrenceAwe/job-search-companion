const requirementSchema = (category, necessity, evidence, explanationType) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: category },
    necessity: { type: "string", enum: necessity },
    evidence: { type: "string", enum: evidence },
    requirementQuote: { type: "string" },
    explanation: { type: explanationType },
    suggestedChallenge: explanationType === "string" ? { type: "string", maxLength: 300 } : { type: "null" },
    evidenceFactIds: { type: "array", items: { type: "string" } },
  },
  required: ["category", "necessity", "evidence", "requirementQuote", "explanation", "suggestedChallenge", "evidenceFactIds"],
});
// Bind explanation shape to classifications in the schema, not only the prompt.
const inventoryEntrySchema = { anyOf: [
  requirementSchema(["eligibility"], ["mandatory"], ["incompatible", "missing", "conflicting"], "string"),
  requirementSchema(["work_arrangement"], ["mandatory"], ["incompatible"], "string"),
  requirementSchema(["eligibility", "work_arrangement"], ["mandatory"], ["supported"], "null"),
  requirementSchema(["work_arrangement"], ["mandatory"], ["missing", "conflicting"], "null"),
  requirementSchema(["eligibility", "work_arrangement"], ["unclear", "preferred", "excluded"], ["supported", "incompatible", "missing", "conflicting"], "null"),
] };
export const requirementInventorySchema = {
  type: "object",
  additionalProperties: false,
  properties: { requirements: { type: "array", items: inventoryEntrySchema } },
  required: ["requirements"],
};

export const challengeReviewSchema = {
  ...requirementInventorySchema,
  properties: {
    ...requirementInventorySchema.properties,
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
