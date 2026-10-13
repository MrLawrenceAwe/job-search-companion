import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCheckerComparison } from "../../scripts/evaluations/comparison-summary.js";

const run = (name, variant, durationMs, outputBytes, extra = {}) => ({
  round: 1, case: name, variant, durationMs, outputBytes,
  outcome: "no_blockers_found", passed: true, ...extra,
});

test("comparison statistics pair revisions and exclude failed and unmatched timings", () => {
  const result = summarizeCheckerComparison([
    run("first", "baseline", 200, 100), run("first", "current", 100, 80),
    run("second", "baseline", 400, 200), run("second", "current", 300, 120, { passed: false }),
    run("failed", "baseline", 1, 0, { outcome: null, error: "Account error", passed: false }),
    run("failed", "current", 900, 900),
    run("unmatched", "baseline", 10, 10),
  ]);
  assert.equal(result.completedPairs, 2);
  assert.equal(result.excludedPairs, 2);
  assert.equal(result.improvementPercent, 33.3);
  assert.deepEqual(result.summary, {
    baseline: { medianMs: 300, medianOutputBytes: 150, passed: 3, incorrectOutcomes: 0, errors: 1 },
    current: { medianMs: 200, medianOutputBytes: 100, passed: 2, incorrectOutcomes: 1, errors: 0 },
  });
});

test("comparison with no completed pairs reports unavailable statistics", () => {
  const result = summarizeCheckerComparison([run("unmatched", "current", 1, 1)]);
  assert.equal(result.completedPairs, 0);
  assert.equal(result.excludedPairs, 1);
  assert.equal(result.improvementPercent, null);
  for (const variant of ["baseline", "current"]) {
    assert.equal(result.summary[variant].medianMs, null);
    assert.equal(result.summary[variant].medianOutputBytes, null);
  }
});
