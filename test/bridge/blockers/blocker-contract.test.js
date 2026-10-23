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
  const finding = { kind: "blocker", suggestedChallenge: "What evidence would resolve this finding?" };
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
  const finding = { kind: "blocker", requirementQuote: "full licence required", suggestedChallenge: "What licence evidence would resolve this finding?" };
  const blocker = { ...record, outcome: "blocker", findings: [finding],
    overriddenRequirementQuotes: [finding.requirementQuote] };
  assert.equal(blockerContract.isRetainableResult(blocker), true);
  assert.deepEqual(blockerContract.getRemainingFindings(blocker), []);
  for (const overriddenRequirementQuotes of [null, "full licence required", ["invented requirement"], [finding.requirementQuote, finding.requirementQuote]]) {
    assert.equal(blockerContract.isRetainableResult({ ...blocker, overriddenRequirementQuotes }), false);
  }
});
