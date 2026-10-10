import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { summarizeBlockerBenchmark } from "../../scripts/evaluations/benchmark-summary.js";

const run = (fixture, reasoningEffort, durationMs, extra = {}) => ({
  round: 1, case: fixture, reasoningEffort, durationMs,
  outcome: "no_blockers_found", passed: true, ...extra,
});

test("latency compares matched completed pairs and reports errors separately from accuracy failures", () => {
  const summary = summarizeBlockerBenchmark([
    run("paired", "low", 100), run("paired", "medium", 200),
    run("error", "low", 1, { outcome: null, error: "Usage limit", passed: false }),
    run("error", "medium", 900),
    run("incorrect", "low", 200, { passed: false }), run("incorrect", "medium", 300),
    run("unpaired", "low", 10),
  ]);
  assert.deepEqual(summary.medians, { low: 150, medium: 250 });
  assert.equal(summary.completedPairs, 2);
  assert.equal(summary.excludedPairs, 2);
  assert.deepEqual(summary.failures, {
    low: { requestErrors: 1, incorrectOutcomes: 1 },
    medium: { requestErrors: 0, incorrectOutcomes: 0 },
  });
  assert.equal(summary.improvementPercent, 40);
  assert.equal(summary.recommendation, "medium");
});

test("no completed pairs produce unavailable latency statistics and retain medium", () => {
  for (const runs of [[], [run("error", "low", 1, { outcome: null, error: "Limit", passed: false }),
    run("error", "medium", 10)], [run("unpaired", "low", 10)]]) {
    const summary = summarizeBlockerBenchmark(runs);
    assert.deepEqual(summary.medians, { low: null, medium: null });
    assert.equal(summary.improvementPercent, null);
    assert.equal(summary.recommendation, "medium");
  }
});

test("odd sample medians use the middle pair and low requires sufficient improvement with all outcomes passing", () => {
  const runs = [
    run("a", "low", 50), run("a", "medium", 100),
    run("b", "low", 80), run("b", "medium", 100),
    run("c", "low", 90), run("c", "medium", 100),
  ];
  const summary = summarizeBlockerBenchmark(runs);
  assert.deepEqual(summary.medians, { low: 80, medium: 100 });
  assert.equal(summary.recommendation, "low");
  assert.equal(summarizeBlockerBenchmark(runs, 21).recommendation, "medium");
});

test("historical usage-limit failures cannot inflate the measured Light advantage", async () => {
  const report = JSON.parse(await readFile(new URL(
    "../../docs/evaluations/2026-10-09T10-50-04-481Z-blocker-benchmark.json", import.meta.url), "utf8"));
  const summary = summarizeBlockerBenchmark(report.runs);
  assert.deepEqual(summary.medians, { low: 5176, medium: 5262 });
  assert.equal(summary.improvementPercent, 1.6);
  assert.equal(summary.completedPairs, 4);
  assert.equal(summary.excludedPairs, 2);
  assert.deepEqual(summary.failures.low, { requestErrors: 2, incorrectOutcomes: 1 });
  assert.deepEqual(summary.failures.medium, { requestErrors: 2, incorrectOutcomes: 0 });
  assert.equal(summary.recommendation, "medium");
});
