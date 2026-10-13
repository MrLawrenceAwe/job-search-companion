import { completedRunPairs, median } from "./statistics.js";

export const summarizeBlockerBenchmark = (runs, minimumImprovementPercent = 20) => {
  // Keep the same cases and rounds for both efforts; errors are not completion times.
  const { completed, excludedPairs } = completedRunPairs(runs, "reasoningEffort", ["low", "medium"]);
  const medians = Object.fromEntries(["low", "medium"].map((effort) =>
    [effort, median(completed.map((pair) => pair[effort].durationMs))]));
  const improvement = completed.length && medians.medium > 0
    ? (medians.medium - medians.low) / medians.medium * 100 : null;
  const failures = Object.fromEntries(["low", "medium"].map((effort) => {
    const samples = runs.filter((run) => run.reasoningEffort === effort);
    return [effort, {
      requestErrors: samples.filter((run) => run.error || !run.outcome).length,
      incorrectOutcomes: samples.filter((run) => !run.error && run.outcome && !run.passed).length,
    }];
  }));
  return {
    comparisonMethod: "matched_completed_pairs",
    completedPairs: completed.length,
    excludedPairs,
    medians,
    failures,
    improvementPercent: improvement === null ? null : Math.round(improvement * 10) / 10,
    minimumImprovementPercent,
    recommendation: improvement !== null && improvement >= minimumImprovementPercent &&
      runs.every((run) => run.passed) ? "low" : "medium",
  };
};
