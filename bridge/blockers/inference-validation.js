import { blockerContract } from "../../shared/contracts.js";

const { suggestedChallengeLimits } = blockerContract;

const normalizeQuote = (text) => text.replace(/\s+/g, " ").trim();

export class RequirementQuoteError extends Error {
  constructor(index, quote) {
    super(`Checker requirement ${index + 1} was not quoted exactly from the advert. Blocker status is unknown.`);
    this.code = "requirement_quote_mismatch";
    this.feedback = { requirementIndex: index + 1, rejectedQuote: quote,
      problem: "This quote is not an exact substring of jobDescription. Copy a contiguous excerpt verbatim. Return the complete requirement inventory, retaining every candidate requirement." };
  }
}

export class RequirementValidationError extends Error {
  constructor(index, requirement, problem) {
    super(`The checker returned an invalid assessment (${problem}). Blocker status is unknown.`);
    this.code = "requirement_validation_failed";
    this.feedback = {
      requirementIndex: index + 1,
      rejectedQuote: requirement?.requirementQuote ?? null,
      problem: `${problem}. Correct this entry against jobDescription and candidateEvidence. Return the complete requirement inventory, retaining every candidate requirement. Do not drop a requirement to bypass validation.`,
    };
  }
}

export const deriveValidatedFindings = (requirements, description, evidence) => {
  if (!Array.isArray(requirements) || requirements.length > 60)
    throw new Error("Invalid checker requirements");
  const facts = new Map(evidence.facts.map((fact) => [fact.id, fact]));
  const normalizedDescription = normalizeQuote(description);
  const findings = [];
  if (!requirements.length && /\b(?:must|required|essential|experience\s+(?:in|with)|proven(?:\s+\w+){0,5}\s+experience|qualifications?|certifications?)\b/i.test(description))
    throw new Error("Checker returned no requirement inventory for an advert with candidate requirements. Retry the check.");
  for (const [index, requirement] of requirements.entries()) {
    const producesFinding = requirement &&
      requirement.necessity === "mandatory" && requirement.evidence !== "supported" &&
      (requirement.category === "eligibility" || requirement.evidence === "incompatible");
    const reject = (problem) => { throw new RequirementValidationError(index, requirement, problem); };
    if (!requirement || Object.keys(requirement).sort().join(",") !==
        "category,evidence,evidenceFactIds,explanation,necessity,requirementQuote,suggestedChallenge")
      reject("invalid requirement fields");
    if (!["eligibility", "work_arrangement"].includes(requirement.category) ||
        !["mandatory", "unclear", "preferred", "excluded"].includes(requirement.necessity) ||
        !["supported", "incompatible", "missing", "conflicting"].includes(requirement.evidence))
      reject("invalid requirement classification");
    if (typeof requirement.requirementQuote !== "string" || !requirement.requirementQuote.trim() ||
        requirement.requirementQuote.length > 2000)
      reject("missing or oversized advert quote");
    if (producesFinding) {
      if (typeof requirement.explanation !== "string" || !requirement.explanation.trim())
        reject("missing requirement explanation");
      if (requirement.explanation.length > 2000) reject("requirement explanation is too long");
      if (typeof requirement.suggestedChallenge !== "string" || !requirement.suggestedChallenge.trim())
        reject("missing suggested challenge");
      if (requirement.suggestedChallenge.length > suggestedChallengeLimits.maximumCharacters || requirement.suggestedChallenge.trim().split(/\s+/).length > suggestedChallengeLimits.maximumWords)
        reject(`suggested challenge exceeds ${suggestedChallengeLimits.maximumWords} words or ${suggestedChallengeLimits.maximumCharacters} characters`);
    } else if (requirement.explanation !== null || requirement.suggestedChallenge !== null) {
      reject("non-blocking requirement must have null explanation and suggested challenge");
    }
    if (!Array.isArray(requirement.evidenceFactIds)) reject("invalid evidence reference list");
    if (requirement.evidenceFactIds.some((id) => !facts.has(id))) reject("unknown evidence reference");
    if (["supported", "incompatible", "conflicting"].includes(requirement.evidence) && !requirement.evidenceFactIds.length)
      reject("evidence classification requires supplied fact references");
    if (requirement.evidence === "missing" && requirement.evidenceFactIds.length)
      reject("missing evidence must have no fact references");
    if (!normalizedDescription.includes(normalizeQuote(requirement.requirementQuote)))
      throw new RequirementQuoteError(index, requirement.requirementQuote);
    if (!producesFinding) continue;
    findings.push({
      kind: "blocker",
      requirementQuote: requirement.requirementQuote,
      explanation: requirement.explanation,
      suggestedChallenge: requirement.suggestedChallenge.trim(),
      evidenceFacts: [...new Set(requirement.evidenceFactIds)].map((id) => facts.get(id)),
    });
  }
  return findings;
};

const hasExactKeys = (value, keys) => Boolean(value &&
  Object.keys(value).sort().join(",") === keys);

export const validateInferenceOutput = (output, hasChallenge) => {
  if (hasChallenge && (typeof output?.challengeResponse !== "string" ||
      !output.challengeResponse.trim() || output.challengeResponse.length > 2000)) {
    throw new Error("Checker did not respond to your challenge. Try again.");
  }
  const keys = hasChallenge
    ? "challengeAccepted,challengeResponse,profileUpdates,requirements"
    : "requirements";
  if (!hasExactKeys(output, keys)) throw new Error("Invalid checker output");
};

export const validateProfileCorrections = (output, evidence) => {
  const editableFactIds = new Set(evidence.facts.filter((fact) => fact.id.startsWith("F"))
    .map((fact) => fact.id));
  const validUpdate = (update) => hasExactKeys(update, "replacesFactIds,text") &&
    typeof update.text === "string" && update.text.trim() && update.text.length <= 1000 &&
    !/[\r\n]/.test(update.text) && Array.isArray(update.replacesFactIds) &&
    update.replacesFactIds.every((id) => editableFactIds.has(id));
  if (typeof output.challengeAccepted !== "boolean" || !Array.isArray(output.profileUpdates) ||
      output.profileUpdates.length > 5 || (!output.challengeAccepted && output.profileUpdates.length) ||
      !output.profileUpdates.every(validUpdate)) {
    throw new Error("Invalid profile correction in challenge response");
  }
};

export const validateChallengeDecision = (output, findings, challenge) => {
  const quote = normalizeQuote(challenge.requirementQuote);
  const matches = (item) => normalizeQuote(item.requirementQuote) === quote;
  if (!output.requirements.some(matches) || output.challengeAccepted === findings.some(matches)) {
    throw new ChallengeDecisionError(challenge.requirementQuote);
  }
};

export class ChallengeDecisionError extends Error {
  constructor(requirementQuote) {
    super("Challenge reply did not match the updated findings. Try again.");
    this.code = "challenge_decision_mismatch";
    this.feedback = {
      challengedQuote: requirementQuote,
      problem: "Keep the challengedQuote unchanged as a requirementQuote in the complete inventory. Assess it against candidateClarification as well as candidateEvidence. Set challengeAccepted true exactly when that requirement produces no blocker, false otherwise, and make challengeResponse and profileUpdates agree. Retain every other candidate requirement; do not drop or weaken requirements to bypass validation.",
    };
  }
}
