const median = (values) => {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const summarizeBlockerBenchmark = (runs, significantThresholdPercent = 20) => {
  const pairs = new Map();
  for (const run of runs) {
    const key = JSON.stringify([run.round, run.case]);
    if (!pairs.has(key)) pairs.set(key, {});
    pairs.get(key)[run.reasoningEffort] = run;
  }
  // Keep the same cases and rounds for both efforts; errors are not completion times.
  const completed = [...pairs.values()].filter((pair) =>
    ["low", "medium"].every((effort) => pair[effort]?.outcome && !pair[effort].error));
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
    excludedPairs: pairs.size - completed.length,
    medians,
    failures,
    improvementPercent: improvement === null ? null : Math.round(improvement * 10) / 10,
    significantThresholdPercent,
    recommendation: improvement !== null && improvement >= significantThresholdPercent &&
      runs.every((run) => run.passed) ? "low" : "medium",
  };
};
