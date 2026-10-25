import assert from "node:assert/strict";
import test from "node:test";
import { comparisonCases } from "../../scripts/evaluations/cases.js";
import { passesEvaluationCase, runEvaluationCase } from "../../scripts/evaluations/run-case.js";

const fixture = comparisonCases.find(({ name }) => name === "renewables-specialist-v1");
const finding = (requirementQuote) => ({ requirementQuote });

test("specialist fixtures require every expected quote regardless of outcome labels", () => {
  assert.equal(passesEvaluationCase(fixture, { findings: [finding("Renewable energy experience")] }), false);
  assert.equal(passesEvaluationCase(fixture, { outcome: "historical-label", findings: [
    finding("Renewable energy experience"), finding("MCS documentation"),
  ] }), true);
  assert.equal(passesEvaluationCase({ expected: "no_blockers_found" }, { findings: [] }), true);
  assert.equal(passesEvaluationCase(fixture, null), false);
});

test("evaluation failures remain reportable and stop only when the account cannot continue", async () => {
  for (const failure of [
    Object.assign(new Error("Account unavailable"), { status: 401 }),
    Object.assign(new Error("Forbidden"), { status: 403 }),
    Object.assign(new Error("Plan limit"), { status: 429 }),
    Object.assign(new Error("Reconnect"), { code: "evaluation_account_unavailable" }),
    new Error("Historical request: 429 usage_limit_reached"),
    new Error("Invalid inference JSON"),
  ]) {
    const run = await runEvaluationCase(fixture, async () => { throw failure; });
    assert.equal(run.stop, failure.message !== "Invalid inference JSON");
    assert.equal(run.error, failure.message);
    assert.equal(run.passed, false);
    assert.equal(run.result, null);
    assert.ok(Number.isFinite(run.durationMs));
  }
});
