export const median = (values) => {
  if (!values.length) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const completedRunPairs = (runs, dimension, variants) => {
  const pairs = new Map();
  for (const run of runs) {
    const key = JSON.stringify([run.round, run.case]);
    if (!pairs.has(key)) pairs.set(key, {});
    pairs.get(key)[run[dimension]] = run;
  }
  const completed = [...pairs.values()].filter((pair) =>
    variants.every((variant) => pair[variant]?.outcome && !pair[variant].error));
  return { completed, excludedPairs: pairs.size - completed.length };
};
