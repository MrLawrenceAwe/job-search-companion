import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { openCvIndex } from "../bridge/blockers/cv-index.js";
import { readVerifiedProfile } from "../bridge/blockers/profile.js";
import { runBlockerInference } from "../bridge/blockers/inference.js";

const directory = join(homedir(), "Library/Application Support/Job Search Companion/blockers");
// Reuse the active account without refreshing credentials outside the running bridge.
const chatgpt = { async request(endpoint, options) {
  const store = JSON.parse(await readFile(join(directory, "chatgpt.json"), "utf8"));
  const account = store.accounts.find((item) => item.id === store.activeId);
  if (!account?.accessToken || account.expiresAt <= Date.now() + 60_000)
    throw new Error("Refresh the connected account through extension settings before verifying.");
  const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    ...options, headers: { ...options.headers, Authorization: `Bearer ${account.accessToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Verification failed: ${response.status} ${body.error?.code || "unknown"}`);
  }
  return response;
} };
const reasoningEffort = process.argv[2] || "medium";
if (!["low", "medium"].includes(reasoningEffort)) throw new Error("Choose low or medium.");
const indexModel = process.argv[3] || "gpt-6-luna";
const started = performance.now();
const readIndex = await openCvIndex({ directory, cvDirectory: join(homedir(), "Job Hunting"), chatgpt });
const index = await readIndex({ model: indexModel, reasoningEffort: "medium" });
const indexingMs = Math.round(performance.now() - started);
const base = await readVerifiedProfile([
  { kind: "application", path: join(homedir(), "Job Hunting/profile.md") },
  { kind: "verified", path: join(homedir(), ".codex/skills/apply-to-jobs/references/profile.md") },
]);
const profile = { ...base, facts: [...base.facts, ...index.facts.map((fact, i) => ({ ...fact, id: `CV${i + 1}` }))] };
const cases = [
  { name: "renewables-specialist", description: await readFile(new URL("../test-support/renewables-administrator.txt", import.meta.url), "utf8"), expected: "uncertain_requirement" },
  { name: "documented-qualification", description: "Remote software tester. You must have a BSc Computer Science degree and ISTQB Foundation certification. Manual testing experience is essential. Commercial automation experience is desirable but not required. No driving or travel required.", expected: "no_blockers_found" },
  { name: "mandatory-driving", description: "Customer support coordinator. You must hold a full UK driving licence and drive to customer sites every day. This is an essential requirement. The position involves handling customer enquiries and updating CRM records.", expected: "clear_blocker" },
];
const runs = [];
for (const fixture of cases) {
  const start = performance.now();
  const result = await runBlockerInference({ chatgpt, model: "gpt-6-luna", reasoningEffort, profile,
    description: fixture.description, signal: AbortSignal.timeout(90_000) });
  const run = { case: fixture.name, durationMs: Math.round(performance.now() - start), outcome: result.outcome,
    expected: fixture.expected, passed: result.outcome === fixture.expected, findings: result.findings };
  if (fixture.name === "renewables-specialist")
    run.passed &&= result.findings.some((finding) => /renew|energy/i.test(finding.requirementQuote))
      && result.findings.some((finding) => /MCS|compliance documentation/i.test(finding.requirementQuote));
  runs.push(run);
  console.log(JSON.stringify({ ...run, findings: run.findings.map(({ kind, requirementQuote }) => ({ kind, requirementQuote })) }));
}
const report = { measuredAt: new Date().toISOString(), model: "gpt-6-luna", reasoningEffort,
  requestedServiceTier: "priority", indexModel, indexingMs, cvFiles: index.sources.length, indexedFacts: index.facts.length,
  indexCharacters: index.facts.reduce((count, fact) => count + fact.text.length, 0), runs };
await writeFile(new URL(`../docs/cv-blocker-verification-${indexModel}-${reasoningEffort}.json`, import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ indexingMs, cvFiles: report.cvFiles, indexedFacts: report.indexedFacts, indexCharacters: report.indexCharacters, allPassed: runs.every((run) => run.passed) }));
if (runs.some((run) => !run.passed)) process.exitCode = 1;
