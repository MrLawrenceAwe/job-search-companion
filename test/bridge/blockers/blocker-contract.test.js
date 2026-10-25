import assert from "node:assert/strict";
import test from "node:test";
import { blockerContract } from "../../../shared/contracts.js";

const record = {
  checkerVersion: blockerContract.version,
  outcome: "no_blockers_found",
  findings: [],
  jobId: "first111",
  descriptionHash: "description",
  evidenceHash: "profile",
  model: "test",
  checkedAt: new Date().toISOString(),
};
test("shared blocker validation rejects expired, unknown and incomplete records", () => {
  assert.equal(blockerContract.isRetainableResult(record), true);
  for (const patch of [
    { checkerVersion: blockerContract.version - 1 },
    { checkerVersion: -1 },
    { outcome: "toString" },
    { outcome: "uncertain_requirement" },
    { outcome: "blocker", findings: [] },
    { findings: [{ kind: "blocker" }] },
    { outcome: "blocker", findings: [{ kind: "uncertain_requirement" }] },
    { checkedAt: "invalid" },
    { model: null },
    { evidenceHash: null },
    { descriptionHash: null },
    { findings: null },
  ]) {
    assert.equal(blockerContract.isRetainableResult({ ...record, ...patch }), false);
  }
  assert.equal(
    blockerContract.isRetainableResult(
      record,
      Date.parse(record.checkedAt) + blockerContract.retentionMs,
    ),
    false,
  );
});

test("saved blockers require concise prepared suggestions", () => {
  const finding = { kind: "blocker", requirementQuote: "full licence required", explanation: "Only a provisional licence is documented.", evidenceFacts: [], suggestedChallenge: "What evidence would resolve this finding?" };
  const blocker = { ...record, outcome: "blocker", findings: [finding] };
  assert.equal(blockerContract.isRetainableResult(blocker), true);
  const { maximumCharacters, maximumWords } = blockerContract.suggestedChallengeLimits;
  for (const suggestedChallenge of ["a".repeat(maximumCharacters), Array(maximumWords).fill("word").join(" ")]) {
    assert.equal(blockerContract.isRetainableResult({ ...blocker,
      findings: [{ ...finding, suggestedChallenge }] }), true);
  }
  for (const suggestedChallenge of [undefined, null, "", "  ", "a".repeat(301), "word ".repeat(26)]) {
    assert.equal(blockerContract.isRetainableResult({ ...blocker,
      findings: [{ ...finding, suggestedChallenge }] }), false);
  }
});

test("overrides reference actual findings without changing the original outcome", () => {
  const finding = { kind: "blocker", requirementQuote: "full licence required", explanation: "Only a provisional licence is documented.", evidenceFacts: [], suggestedChallenge: "What licence evidence would resolve this finding?" };
  const blocker = { ...record, outcome: "blocker", findings: [finding],
    overriddenRequirementQuotes: [finding.requirementQuote] };
  assert.equal(blockerContract.isRetainableResult(blocker), true);
  assert.deepEqual(blockerContract.getRemainingFindings(blocker), []);
  for (const overriddenRequirementQuotes of [null, "full licence required", ["invented requirement"], [finding.requirementQuote, finding.requirementQuote]]) {
    assert.equal(blockerContract.isRetainableResult({ ...blocker, overriddenRequirementQuotes }), false);
  }
});

test("saved findings reject missing render fields and malformed evidence", () => {
  const finding = { kind: "blocker", requirementQuote: "full licence required",
    explanation: "Only a provisional licence is documented.", evidenceFacts: [],
    suggestedChallenge: "What licence evidence would resolve this finding?" };
  const retainable = (value) => blockerContract.isRetainableResult({ ...record, outcome: "blocker", findings: [value] });
  for (const key of ["requirementQuote", "explanation", "evidenceFacts"]) {
    const { [key]: omitted, ...incomplete } = finding;
    assert.equal(retainable(incomplete), false);
  }
  for (const patch of [
    { requirementQuote: " " }, { explanation: null }, { explanation: " " },
    { explanation: "word ".repeat(blockerContract.limits.maximumExplanationWords + 1) },
    { evidenceFacts: [null] }, { evidenceFacts: [{ id: "F1", source: "Profile" }] },
  ]) assert.equal(retainable({ ...finding, ...patch }), false);
  assert.equal(retainable({ ...finding, evidenceFacts: [{ id: "F1", source: "Profile", text: "Provisional licence" }] }), true);
});

test("stored check identity covers job, description, evidence, model and effort", () => {
  const inputs = { jobId: "first111", descriptionHash: "description", evidenceHash: "evidence", model: "test", reasoningEffort: "medium" };
  assert.equal(blockerContract.sameCheckInputs(inputs, { ...inputs, checkedAt: "later" }), true);
  for (const key of Object.keys(inputs))
    assert.equal(blockerContract.sameCheckInputs(inputs, { ...inputs, [key]: "changed" }), false);
});
