import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openCvIndex } from "../../bridge/blockers/cv-index.js";
import { blockerSources } from "../../shared/blocker-sources.js";
import { sha256 } from "../../shared/sha256.js";
import { writeEvaluationReport } from "./support.js";
import { median } from "./statistics.js";

const baselineRef = process.argv[2];
if (!baselineRef) throw new Error("Usage: node scripts/evaluations/benchmark-cv-preparation.js <baseline-git-ref>");
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = execFileSync("git", ["show", `${baselineRef}:bridge/blockers/cv-index.js`], { cwd: root, encoding: "utf8" });
const rewritten = source.replace(/from "(\.[^"]+)"/g, (_, path) =>
  `from ${JSON.stringify(new URL(path, pathToFileURL(join(root, "bridge/blockers/cv-index.js"))).href)}`);
const baseline = await import(`data:text/javascript;base64,${Buffer.from(rewritten).toString("base64")}`);
const runs = [];
let evidenceHash;
for (let round = 1; round <= 3; round++) {
  for (const variant of round % 2 ? ["baseline", "current"] : ["current", "baseline"]) {
    const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-cv-preparation-"));
    try {
      let passages;
      const index = await (variant === "baseline" ? baseline.openCvIndex : openCvIndex)({
        directory, cvDirectory: blockerSources().cvDirectory,
        // Real source reads/converters, no network or model latency. Select one
        // passage only to exercise validation/save; hash the complete model input.
        chatgpt: { async request(endpoint, options) {
          passages = JSON.parse(JSON.parse(options.body).input[0].content).passages;
          const hash = sha256(JSON.stringify(passages));
          evidenceHash ??= hash;
          assert.equal(hash, evidenceHash, "Prepared evidence changed between runs");
          return new Response(`data: ${JSON.stringify({ type: "response.completed", response: {
            status: "completed", output: [{ type: "message", role: "assistant",
              content: [{ type: "output_text", text: JSON.stringify({ passageIds: [passages[0].id] }) }] }],
          } })}\n\n`);
        } },
      });
      const started = performance.now();
      const result = await index.ensureCurrent({ model: "local-preparation-benchmark" });
      const coldMs = +(performance.now() - started).toFixed(2);
      const warmStarted = performance.now();
      await index.ensureCurrent({ model: "local-preparation-benchmark" });
      runs.push({ round, variant, coldMs, warmMs: +(performance.now() - warmStarted).toFixed(2),
        sourceCount: result.sources.length, passageCount: passages.length });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
const summary = Object.fromEntries(["baseline", "current"].map((variant) => {
  const samples = runs.filter((run) => run.variant === variant);
  return [variant, {
    medianColdMs: median(samples.map((run) => run.coldMs)),
    medianWarmMs: median(samples.map((run) => run.warmMs)),
  }];
}));
const report = {
  measuredAt: new Date().toISOString(),
  comparison: "Local CV preparation only; real converters, mocked index response, no model or network requests",
  baselineRef: execFileSync("git", ["rev-parse", baselineRef], { cwd: root, encoding: "utf8" }).trim(),
  baselineSourceHash: sha256(source),
  currentSourceHash: sha256(await readFile(join(root, "bridge/blockers/cv-index.js"))),
  evidenceHash, summary,
  coldImprovementPercent: +(100 * (1 - summary.current.medianColdMs / summary.baseline.medianColdMs)).toFixed(1),
  runs,
};
const path = await writeEvaluationReport("cv-preparation-performance", report);
console.log(JSON.stringify({ reportPath: fileURLToPath(path), ...report }, null, 2));
