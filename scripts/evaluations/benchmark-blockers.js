import { benchmarkCases } from "./cases.js";
import { fileURLToPath } from "node:url";
import { createEvaluationClient, readEvaluationProfile, writeEvaluationReport } from "./support.js";
import { runBlockerInference } from "../../bridge/blockers/inference.js";
import { summarizeBlockerBenchmark } from "./benchmark-summary.js";

const evidence = await readEvaluationProfile();
const cases = benchmarkCases;
const chatgpt = createEvaluationClient();
const runs = [];
for (let round = 0; round < 2; round++) {
  for (const [index, fixture] of cases.entries()) {
    // Alternate first effort across cases and rounds to reduce ordering bias.
    for (const reasoningEffort of (round + index) % 2 ? ["medium", "low"] : ["low", "medium"]) {
      const started = performance.now();
      let result = null;
      let error = null;
      try {
        result = await runBlockerInference({ chatgpt, model: "gpt-6-luna", reasoningEffort,
          description: fixture.description, evidence, signal: AbortSignal.timeout(90_000) });
      } catch (failure) {
        error = failure.message;
      }
      const run = { round: round + 1, case: fixture.name, reasoningEffort,
        durationMs: Math.round(performance.now() - started), outcome: result?.outcome || null,
        expected: fixture.expected, passed: result?.outcome === fixture.expected,
        findings: result?.findings.map(({ kind, requirementQuote }) => ({ kind, requirementQuote })) || [],
        ...(error ? { error } : {}) };
      runs.push(run);
      console.log(JSON.stringify(run));
    }
  }
}
const summary = summarizeBlockerBenchmark(runs);
const report = { measuredAt: new Date().toISOString(), model: "gpt-6-luna", requestedServiceTier: "priority",
  deliveredServiceTier: "unconfirmed", rounds: 2, cases, runs, ...summary };
const reportPath = await writeEvaluationReport("blocker-benchmark", report);
console.log(`Report: ${fileURLToPath(reportPath)}`);
console.log(JSON.stringify(summary));

if (runs.some((run) => !run.passed)) process.exitCode = 1;
