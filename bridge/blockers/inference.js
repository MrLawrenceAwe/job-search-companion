import { readCompletedJsonResponse } from "./chatgpt-response.js";
import { inferenceSettingsContract } from "../../shared/contracts.js";
import { blockerInstructions, challengeInstructions } from "./inference-prompts.js";
import { requirementInventorySchema, challengeReviewSchema } from "./inference-schemas.js";
import {
  RequirementQuoteError,
  deriveValidatedFindings,
  validateInferenceOutput,
  validateProfileCorrections,
  validateChallengeDecision,
} from "./inference-validation.js";

export const runBlockerInference = async ({
  chatgpt, model, reasoningEffort = "medium", description, evidence, challenge = null, signal,
}) => {
  const clarification = challenge ? {
    id: "CH1",
    source: "Your blocker challenge (self-reported, this job only)",
    text: `Regarding “${challenge.requirementQuote}”: ${challenge.reason}`,
  } : null;
  const checkEvidence = clarification
    ? { ...evidence, facts: [...evidence.facts, clarification] }
    : evidence;
  let validationFeedback;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal?.throwIfAborted();
    const response = await chatgpt.request("responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        ...inferenceSettingsContract.inferenceOptions(model, reasoningEffort),
        store: false,
        stream: true,
        instructions: blockerInstructions + (challenge ? "\n" + challengeInstructions : ""),
        input: [{
          role: "user",
          content: JSON.stringify({
            candidateEvidence: evidence.facts,
            ...(challenge ? {
              blockerChallenge: { ...challenge, factId: clarification.id },
              candidateClarification: clarification,
            } : {}),
            jobDescription: description,
            ...(validationFeedback ? { validationFeedback } : {}),
          }),
        }],
        text: {
          format: {
            type: "json_schema",
            name: "requirement_inventory",
            strict: true,
            schema: challenge ? challengeReviewSchema : requirementInventorySchema,
          },
        },
      }),
    });
    const output = await readCompletedJsonResponse(response);
    let findings;
    try {
      validateInferenceOutput(output, Boolean(challenge));
      if (challenge) validateProfileCorrections(output, evidence);
      findings = deriveValidatedFindings({ requirements: output.requirements }, description, checkEvidence);
      if (challenge) validateChallengeDecision(output, findings, challenge);
    } catch (error) {
      // Retry only a completed response with a bad quote, within the caller's deadline.
      // Network, account, stream and other evidence errors remain failures.
      if (!(error instanceof RequirementQuoteError) || attempt === 1) throw error;
      validationFeedback = error.feedback;
      continue;
    }
    return {
      outcome: findings.length ? "blocker" : "no_blockers_found",
      findings,
      ...(challenge ? {
        challengeReview: {
          requirementQuote: challenge.requirementQuote,
          response: output.challengeResponse,
          accepted: output.challengeAccepted,
        },
        profileUpdates: output.profileUpdates,
      } : {}),
    };
  }
};
