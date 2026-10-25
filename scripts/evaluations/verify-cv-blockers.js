import { runEvaluationCase } from "./run-case.js";
import { inferenceSettingsContract } from "../../shared/contracts.js";
import { cvVerificationCases } from "./cases.js";
import { combineProfileAndCvEvidence } from "../../bridge/blockers/evidence.js";
import { fileURLToPath } from "node:url";
import { blockerSources } from "../../shared/blocker-sources.js";
import { createEvaluationClient, readEvaluationProfile, writeEvaluationReport, inferenceReportMetadata } from "./support.js";
import { openCvIndex } from "../../bridge/blockers/cv-index.js";
import { runBlockerInference } from "../../bridge/blockers/inference.js";

const { directory, cvDirectory } = blockerSources();
const chatgpt = createEvaluationClient();
const reasoningEffort = process.argv[2] || inferenceSettingsContract.defaultReasoningEffort;
if (!inferenceSettingsContract.checkerReasoningEfforts.includes(reasoningEffort)) throw new Error("Choose low or medium.");
const indexModel = process.argv[3] || "gpt-6-luna";
const started = performance.now();
const cvIndex = await openCvIndex({ directory, cvDirectory, chatgpt });
const index = await cvIndex.ensureCurrent({ model: indexModel, reasoningEffort: inferenceSettingsContract.indexingReasoningEffort });
const indexingMs = Math.round(performance.now() - started);
const base = await readEvaluationProfile();
const evidence = combineProfileAndCvEvidence(base, index);
const cases = cvVerificationCases;
const runs = [];
for (const fixture of cases) {
  const { result, error, durationMs, passed, stop } = await runEvaluationCase(fixture, () =>
    runBlockerInference({ chatgpt, model: "gpt-6-luna", reasoningEffort, evidence,
      description: fixture.description, signal: AbortSignal.timeout(90_000) }));
  const run = { case: fixture.name, durationMs, outcome: result?.outcome || null,
    expected: fixture.expected, passed, findings: result?.findings || [],
    ...(error ? { error } : {}) };
  runs.push(run);
  console.log(JSON.stringify({ ...run, findings: run.findings.map(({ kind, requirementQuote }) => ({ kind, requirementQuote })) }));
  if (stop) break;
}
const report = { measuredAt: new Date().toISOString(), model: "gpt-6-luna", reasoningEffort,
  ...inferenceReportMetadata(evidence),
  requestedServiceTier: "priority", indexModel, indexingMs, cvFiles: index.sources.length, indexedFacts: index.facts.length,
  indexCharacters: index.facts.reduce((count, fact) => count + fact.text.length, 0), runs };
const reportPath = await writeEvaluationReport(`cv-blocker-verification-${indexModel}-${reasoningEffort}`, report);
console.log(`Report: ${fileURLToPath(reportPath)}`);
console.log(JSON.stringify({ indexingMs, cvFiles: report.cvFiles, indexedFacts: report.indexedFacts, indexCharacters: report.indexCharacters, allPassed: runs.every((run) => run.passed) }));
if (runs.some((run) => !run.passed)) process.exitCode = 1;
