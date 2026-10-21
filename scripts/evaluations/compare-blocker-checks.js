import { comparisonCases } from "./cases.js";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../../shared/sha256.js";
import { blockerSources } from "../../shared/blocker-sources.js";
import { combineProfileAndCvEvidence } from "../../bridge/blockers/evidence.js";
import { runBlockerInference } from "../../bridge/blockers/inference.js";
import { blockerInstructions } from "../../bridge/blockers/inference-prompts.js";
import { requirementInventorySchema } from "../../bridge/blockers/inference-schemas.js";
import { openRevision } from "./revision.js";
import { createEvaluationClient, readEvaluationProfile, writeEvaluationReport } from "./support.js";
import { createMeasuredClient } from "./measured-client.js";
import { summarizeCheckerComparison } from "./comparison-summary.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const baselineRef = process.argv[2] || "HEAD";
const currentReasoningEffort = process.argv[3] || "medium";
if (!["low", "medium"].includes(currentReasoningEffort)) {
  throw new Error("Choose low or medium for the current checker comparison");
}

const revision = await openRevision(baselineRef);
try {
  const baseline = await revision.importModule("bridge/blockers/inference.js");
  const { blockerContract: baselineContract } = await revision.importModule("shared/contracts.js");
  const baselinePrompts = baselineContract.version >= 13
    ? await revision.importModule("bridge/blockers/inference-prompts.js") : baseline;
  const baselineSchemas = baselineContract.version >= 13
    ? await revision.importModule("bridge/blockers/inference-schemas.js") : baseline;
  const base = await readEvaluationProfile();
  // Freeze saved evidence; never invoke index inference or write checker settings/cache.
  const index = JSON.parse(await readFile(join(blockerSources().directory, "cv-index.json"), "utf8"));
  if (!index.facts?.length) throw new Error("A saved CV evidence index is required for the comparison.");
  const evidence = combineProfileAndCvEvidence(base, index);
  const cases = comparisonCases;
  const client = createEvaluationClient();
  const runs = [];

  const runCase = async (fixture, round, variant) => {
    const inference = variant === "baseline" ? baseline.runBlockerInference : runBlockerInference;
    const chatgpt = createMeasuredClient(client);
    const reasoningEffort = variant === "baseline" ? "medium" : currentReasoningEffort;
    const started = performance.now();
    let result;
    let error;
    try {
      result = await inference({
        chatgpt,
        model: "gpt-6-luna",
        reasoningEffort,
        description: fixture.description,
        // Older revisions intentionally keep their historical input contract.
        ...(variant === "baseline" && baselineContract.version < 13 ? { profile: evidence } : { evidence }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (failure) {
      error = failure.message;
    }
    // Compare finding presence across revisions; retain each revision's raw outcome
    // in the report so a result-label rename cannot masquerade as an accuracy change.
    const findings = result?.findings || [];
    let passed = Boolean(result) && (fixture.expected === "blocker"
      ? findings.length > 0
      : findings.length === 0);
    if (fixture.name === "renewables-specialist-v1" && result) {
      passed &&= findings.some((finding) => /renew|energy/i.test(finding.requirementQuote))
        && findings.some((finding) => /MCS|compliance documentation/i.test(finding.requirementQuote));
    }
    return {
      round,
      case: fixture.name,
      variant,
      reasoningEffort,
      durationMs: Math.round(performance.now() - started),
      ...chatgpt.metrics,
      outcome: result?.outcome || null,
      expected: fixture.expected,
      passed,
      findings,
      ...(error ? { error } : {}),
    };
  };

  const runComparison = async () => {
    for (let round = 1; round <= 2; round += 1) {
      for (const [caseIndex, fixture] of cases.entries()) {
        const order = (round + caseIndex) % 2
          ? ["baseline", "current"]
          : ["current", "baseline"];
        for (const variant of order) {
          const run = await runCase(fixture, round, variant);
          runs.push(run);
          console.log(JSON.stringify({
            ...run,
            findings: run.findings.map(({ kind, requirementQuote }) => ({ kind, requirementQuote })),
          }));
          if (run.error && /usage.limit|429|Refresh the connected|401|403/i.test(run.error)) return;
        }
      }
    }
  };
  await runComparison();

  const statistics = summarizeCheckerComparison(runs);
  const report = {
    measuredAt: new Date().toISOString(),
    comparison: "baseline revision checker versus working tree checker, matched completed pairs",
    accuracyMethod: "finding presence and required specialist quotes; raw revision outcomes retained",
    baselineRef: execFileSync("git", ["rev-parse", baselineRef], { cwd: root, encoding: "utf8" }).trim(),
    baselinePromptHash: sha256(baselinePrompts.blockerInstructions),
    baselineSchemaHash: sha256(JSON.stringify(baselineSchemas.requirementInventorySchema)),
    currentSchemaHash: sha256(JSON.stringify(requirementInventorySchema)),
    currentPromptHash: sha256(blockerInstructions),
    model: "gpt-6-luna",
    baselineReasoningEffort: "medium",
    currentReasoningEffort,
    requestedServiceTier: "priority",
    deliveredServiceTier: "unconfirmed",
    indexing: "not run; frozen existing evidence snapshot",
    indexFingerprint: index.fingerprint,
    indexModel: index.model,
    indexedAt: index.indexedAt,
    evidenceHash: sha256(JSON.stringify(evidence.facts)),
    ...statistics,
    cases,
    runs,
  };
  const path = await writeEvaluationReport("blocker-check-performance", report);
  console.log(JSON.stringify({ reportPath: fileURLToPath(path), ...statistics }));
  if (runs.some((run) => !run.passed)) process.exitCode = 1;
} finally {
  await revision.close();
}
