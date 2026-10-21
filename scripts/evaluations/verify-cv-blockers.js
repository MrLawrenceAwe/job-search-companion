import { cvVerificationCases } from "./cases.js";
import { combineProfileAndCvEvidence } from "../../bridge/blockers/evidence.js";
import { fileURLToPath } from "node:url";
import { blockerSources } from "../../shared/blocker-sources.js";
import { createEvaluationClient, readEvaluationProfile, writeEvaluationReport } from "./support.js";
import { openCvIndex } from "../../bridge/blockers/cv-index.js";
import { runBlockerInference } from "../../bridge/blockers/inference.js";

const { directory, cvDirectory } = blockerSources();
const chatgpt = createEvaluationClient();
const reasoningEffort = process.argv[2] || "medium";
if (!["low", "medium"].includes(reasoningEffort)) throw new Error("Choose low or medium.");
const indexModel = process.argv[3] || "gpt-6-luna";
const started = performance.now();
const cvIndex = await openCvIndex({ directory, cvDirectory, chatgpt });
const index = await cvIndex.ensureCurrent({ model: indexModel, reasoningEffort: "medium" });
const indexingMs = Math.round(performance.now() - started);
const base = await readEvaluationProfile();
const evidence = combineProfileAndCvEvidence(base, index);
const cases = cvVerificationCases;
const runs = [];
for (const fixture of cases) {
  const start = performance.now();
  const result = await runBlockerInference({ chatgpt, model: "gpt-6-luna", reasoningEffort, evidence,
    description: fixture.description, signal: AbortSignal.timeout(90_000) });
  const run = { case: fixture.name, durationMs: Math.round(performance.now() - start), outcome: result.outcome,
    expected: fixture.expected, passed: result.outcome === fixture.expected, findings: result.findings };
  if (fixture.name === "renewables-specialist-v1")
    run.passed &&= result.findings.some((finding) => /renew|energy/i.test(finding.requirementQuote))
      && result.findings.some((finding) => /MCS|compliance documentation/i.test(finding.requirementQuote));
  runs.push(run);
  console.log(JSON.stringify({ ...run, findings: run.findings.map(({ kind, requirementQuote }) => ({ kind, requirementQuote })) }));
}
const report = { measuredAt: new Date().toISOString(), model: "gpt-6-luna", reasoningEffort,
  requestedServiceTier: "priority", indexModel, indexingMs, cvFiles: index.sources.length, indexedFacts: index.facts.length,
  indexCharacters: index.facts.reduce((count, fact) => count + fact.text.length, 0), runs };
const reportPath = await writeEvaluationReport(`cv-blocker-verification-${indexModel}-${reasoningEffort}`, report);
console.log(`Report: ${fileURLToPath(reportPath)}`);
console.log(JSON.stringify({ indexingMs, cvFiles: report.cvFiles, indexedFacts: report.indexedFacts, indexCharacters: report.indexCharacters, allPassed: runs.every((run) => run.passed) }));
if (runs.some((run) => !run.passed)) process.exitCode = 1;
