import { completedRunPairs, median } from "./statistics.js";

export const summarizeCheckerComparison = (runs) => {
  const variants = ["baseline", "current"];
  const { completed, excludedPairs } = completedRunPairs(runs, "variant", variants);
  const summary = Object.fromEntries(variants.map((variant) => {
    const samples = runs.filter((run) => run.variant === variant);
    return [variant, {
      medianMs: median(completed.map((pair) => pair[variant].durationMs)),
      medianOutputBytes: median(completed.map((pair) => pair[variant].outputBytes)),
      passed: samples.filter((run) => run.passed).length,
      incorrectOutcomes: samples.filter((run) => run.outcome && !run.passed).length,
      errors: samples.filter((run) => run.error).length,
    }];
  }));
  const improvementPercent = summary.baseline.medianMs
    ? +(100 * (1 - summary.current.medianMs / summary.baseline.medianMs)).toFixed(1)
    : null;
  return { completedPairs: completed.length, excludedPairs, summary, improvementPercent };
};
