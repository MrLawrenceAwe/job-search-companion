const normalizeQuote = (text) => text.replace(/\s+/g, " ").trim();

export class RequirementQuoteError extends Error {
  constructor(index, quote) {
    super(`Checker requirement ${index + 1} was not quoted exactly from the advert. Retry the check.`);
    this.code = "requirement_quote_mismatch";
    this.feedback = { requirementIndex: index + 1, rejectedQuote: quote,
      problem: "This quote is not an exact substring of jobDescription. Copy a contiguous excerpt verbatim. Return the complete requirement inventory, retaining every candidate requirement." };
  }
}

export const deriveValidatedFindings = (output, description, evidence) => {
  if (
    !output ||
    Object.keys(output).length !== 1 ||
    !Array.isArray(output.requirements) ||
    output.requirements.length > 60
  )
    throw new Error("Invalid checker output");
  const facts = new Map(evidence.facts.map((fact) => [fact.id, fact]));
  const normalizedDescription = normalizeQuote(description);
  const findings = [];
  if (!output.requirements.length && /\b(?:must|required|essential|experience\s+(?:in|with)|proven(?:\s+\w+){0,5}\s+experience|qualifications?|certifications?)\b/i.test(description))
    throw new Error("Checker returned no requirement inventory for an advert with candidate requirements. Retry the check.");
  for (const [index, requirement] of output.requirements.entries()) {
    const producesFinding = requirement &&
      requirement.necessity === "mandatory" && requirement.evidence !== "supported" &&
      (requirement.category === "eligibility" || requirement.evidence === "incompatible");
    if (
      !requirement ||
      Object.keys(requirement).sort().join(",") !==
        "category,evidence,evidenceFactIds,explanation,necessity,requirementQuote" ||
      !["eligibility", "work_arrangement"].includes(requirement.category) ||
      !["mandatory", "unclear", "preferred", "excluded"].includes(requirement.necessity) ||
      !["supported", "incompatible", "missing", "conflicting"].includes(requirement.evidence) ||
      typeof requirement.requirementQuote !== "string" ||
      !requirement.requirementQuote.trim() ||
      requirement.requirementQuote.length > 2000 ||
      (producesFinding
        ? typeof requirement.explanation !== "string" || !requirement.explanation.trim() || requirement.explanation.length > 2000
        : requirement.explanation !== null) ||
      !Array.isArray(requirement.evidenceFactIds) ||
      requirement.evidenceFactIds.some((id) => !facts.has(id)) ||
      (["supported", "incompatible", "conflicting"].includes(requirement.evidence) && !requirement.evidenceFactIds.length) ||
      (requirement.evidence === "missing" && requirement.evidenceFactIds.length)
    )
      throw new Error("Checker requirements did not match the supplied evidence");
    if (!normalizedDescription.includes(normalizeQuote(requirement.requirementQuote)))
      throw new RequirementQuoteError(index, requirement.requirementQuote);
    if (!producesFinding) continue;
    findings.push({
      kind: "blocker",
      requirementQuote: requirement.requirementQuote,
      explanation: requirement.explanation,
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
    throw new Error("Challenge reply did not match the updated findings. Try again.");
  }
};
