// Shared acceptance and failure rules; commands retain their own measurements.
export const passesEvaluationCase = (fixture, result) => Boolean(result) &&
  (fixture.expected === "blocker" ? result.findings.length > 0 : result.findings.length === 0) &&
  (fixture.requiredQuotePatterns || []).every((pattern) =>
    result.findings.some((finding) => new RegExp(pattern, "i").test(finding.requirementQuote)));

export const runEvaluationCase = async (fixture, infer) => {
  const started = performance.now();
  let result = null;
  let failure;
  try {
    result = await infer();
  } catch (error) {
    failure = error;
  }
  return {
    result,
    passed: passesEvaluationCase(fixture, result),
    durationMs: Math.round(performance.now() - started),
    ...(failure ? { error: failure.message } : {}),
    stop: Boolean(failure && ([401, 403, 429].includes(failure.status) ||
      failure.code === "evaluation_account_unavailable" ||
      /usage.limit|429|Refresh the connected|401|403/i.test(failure.message))),
  };
};
