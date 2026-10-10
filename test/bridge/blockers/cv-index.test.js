import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, unlink, stat, realpath, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCvIndex, validateCvIndex, extractCvText } from "../../../bridge/blockers/cv-index.js";

const text = "WORK EXPERIENCE Software Tester - Boeing | 2023 - 2024 Executed manual tests. PROJECTS Personal Chrome extension | 2026 Built automated project tests.";
const documents = [{ id: "P1", name: "source.pdf", text }];
const response = (output) => new Response(`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(output) }] }] } })}\n\n`);

test("CV indexing rejects invented evidence and preserves employment/project context verbatim", () => {
  const passageIds = ["P1"];
  assert.deepEqual(validateCvIndex({ passageIds }, documents), [{ text, source: "CV: source.pdf" }]);
  for (const output of [{ passageIds: [] }, { passageIds: ["P99"] },
    { passageIds: ["Paid commercial automation engineer"] }])
    assert.throws(() => validateCvIndex(output, documents));
});

test("CV index persists once, shares concurrent refreshes, and rebuilds on edits, additions and deletions", async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-cv-index-"));
  const name = "Lawrence_Awe_CV_Test.pdf";
  await writeFile(join(directory, name), text);
  let calls = 0;
  const chatgpt = { async request(endpoint, options) {
    calls++;
    const request = JSON.parse(options.body);
    assert.ok(["gpt-6-luna", "gpt-6-sol"].includes(request.model));
    if (request.model === "gpt-6-luna") {
      assert.equal(request.service_tier, "priority");
      assert.deepEqual(request.reasoning, { effort: "medium" });
    } else {
      assert.equal(request.service_tier, undefined);
      assert.equal(request.reasoning, undefined);
    }
    const docs = JSON.parse(request.input[0].content).passages;
    return response({ passageIds: docs.map((document) => document.id) });
  } };
  const options = { directory, cvDirectory: directory, chatgpt, extract: (path) => readFile(path, "utf8") };
  const read = await openCvIndex(options);
  const settings = { model: "gpt-6-luna", reasoningEffort: "medium" };
  const [first, shared] = await Promise.all([read.ensureCurrent(settings), read.ensureCurrent(settings)]);
  assert.equal(calls, 1); assert.equal(first.fingerprint, shared.fingerprint);
  const restored = await openCvIndex(options);
  await restored.ensureCurrent(settings); assert.equal(calls, 1);
  assert.equal((await stat(join(directory, "cv-index.json"))).mode & 0o777, 0o600);
  await writeFile(join(directory, name), text + " ISTQB qualified.");
  const edited = await restored.ensureCurrent(settings); assert.equal(calls, 2);
  assert.notEqual(edited.fingerprint, first.fingerprint);
  const extra = join(directory, "Lawrence_Awe_CV_Extra.docx");
  await writeFile(extra, "EDUCATION BSc Computer Science, University of Kent.");
  await restored.ensureCurrent(settings); assert.equal(calls, 3);
  await unlink(extra); await restored.ensureCurrent(settings); assert.equal(calls, 4);
  await writeFile(join(directory, "CV Ready to Upload.pdf"), "Ignore this staged copy.");
  await restored.ensureCurrent(settings); assert.equal(calls, 4);
  assert.equal(await restored.readCurrent({ model: "gpt-6-sol" }), null);
  await restored.ensureCurrent({ model: "gpt-6-sol" }); assert.equal(calls, 5);
  assert.ok(await restored.readCurrent({ model: "gpt-6-sol" }));
});

test("failed or cancelled index refresh never publishes a current index", async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-cv-index-"));
  await writeFile(join(directory, "Lawrence_Awe_CV_Test.pdf"), text);
  const controller = new AbortController();
  const read = await openCvIndex({ directory, cvDirectory: directory, extract: (path) => readFile(path, "utf8"),
    chatgpt: { async request() { controller.abort(); return response({ passageIds: ["P1"] }); } } });
  await assert.rejects(read.ensureCurrent({ model: "test", signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(readFile(join(directory, "cv-index.json")), { code: "ENOENT" });
});

test("cancellation during extraction stops remaining CVs and permits a fresh retry", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-cv-cancel-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (let i = 0; i < 3; i++)
    await writeFile(join(directory, `Lawrence_Awe_CV_${i}.txt`), text);
  const controller = new AbortController();
  let extracts = 0;
  let requests = 0;
  const index = await openCvIndex({ directory, cvDirectory: directory,
    extract: async (path, { signal }) => {
      extracts++;
      if (extracts === 1) {
        assert.equal(signal, controller.signal);
        controller.abort();
      }
      return readFile(path, "utf8");
    },
    chatgpt: { async request() { requests++; return response({ passageIds: ["P1"] }); } },
  });
  await assert.rejects(index.ensureCurrent({ model: "test", signal: controller.signal }), { name: "AbortError" });
  assert.equal(extracts, 1);
  assert.equal(requests, 0);
  await assert.rejects(readFile(join(directory, "cv-index.json")), { code: "ENOENT" });
  assert.ok((await index.ensureCurrent({ model: "test", signal: new AbortController().signal })).facts.length);
  assert.equal(extracts, 4);
  assert.equal(requests, 1);
});

test("already cancelled extraction never opens a source file or starts a converter", async () => {
  for (const extension of ["txt", "pdf", "docx"])
    await assert.rejects(extractCvText(`/missing/cancelled.${extension}`, {
      signal: AbortSignal.abort(),
    }), { name: "AbortError" });
});

test("Word extraction cancels an active converter without waiting for its process timeout", {
  skip: process.platform !== "darwin", timeout: 5000,
}, async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-cv-converter-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "waiting.docx");
  // A pipe with no writer keeps textutil blocked reading, until cancellation kills it.
  await promisify(execFile)("/usr/bin/mkfifo", [path]);
  await assert.rejects(extractCvText(path, { signal: AbortSignal.timeout(100) }), {
    name: "AbortError", code: "ABORT_ERR",
  });
});

test("passages retain complete role and project context while deduplicating repeated sections", async () => {
  const { extractCvPassages } = await import("../../../bridge/blockers/cv-index.js");
  const document = { name: "source.pdf", text: "PROFILE\nSeeking finance work; no bookkeeping experience.\nWORK EXPERIENCE\nSoftware Tester - Boeing | 2023 - 2024\n• Executed manual tests.\nPROJECTS\nExample - Personal project | 2026\n• Built automated tests.\nEDUCATION\nBSc Computer Science." };
  const passages = extractCvPassages([document, { ...document, name: "duplicate.docx" }]);
  assert.equal(passages.length, 4);
  assert.ok(passages.some((p) => /Boeing.*manual tests/.test(p.text)));
  assert.ok(passages.some((p) => /Personal project.*automated tests/.test(p.text)));
  assert.ok(passages.some((p) => /no bookkeeping experience/.test(p.text)));
});

test("checker queues slow indexing without blocking the start response and exposes the same evidence hash in status/results", async () => {
  const { openBlockerChecker } = await import("../../../bridge/blockers/checker.js");
  const { waitUntil } = await import("../../../test-support/async.js");
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-cv-checker-"));
  const cv = join(directory, "Lawrence_Awe_CV_Test.txt");
  const profile = join(directory, "profile.md");
  await writeFile(cv, "WORK EXPERIENCE\nSoftware Tester - Boeing | 2023 - 2024\nExecuted manual software tests, recorded defects and produced reports for review.\nEDUCATION\nBSc Computer Science, University of Kent.");
  await writeFile(profile, "## Personal Constraints\n- Provisional driving licence only.\n");
  let release;
  let calls = 0;
  const chatgpt = {
    close() {},
    connectionStatus: () => ({ activeId: "test", planUsageEnabled: true }),
    models: async () => [{ slug: "gpt-6-luna" }],
    async request(endpoint, options) {
      calls++;
      await new Promise((resolve) => { release = resolve; });
      const passages = JSON.parse(JSON.parse(options.body).input[0].content).passages;
      return response({ passageIds: passages.map((p) => p.id) });
    },
  };
  const checker = await openBlockerChecker({ directory, cvDirectory: directory,
    profileSources: [{ kind: "application", path: profile }], chatgpt,
    infer: async ({ profile }) => {
      assert.ok(profile.facts.some((f) => /Boeing/.test(f.text)));
      return { outcome: "no_blockers_found", findings: [] };
    } });
  await checker.configure({ enabled: true, model: "gpt-6-luna" });
  assert.equal(calls, 0);
  const job = { jobUrl: "https://uk.indeed.com/viewjob?jk=test1111", description: "Software tester handling manual tests and reporting software defects." };
  const first = await checker.start(job);
  assert.ok(["queued", "checking"].includes(first.status));
  await waitUntil(() => release);
  release();
  await waitUntil(() => checker.get(first.id).status === "completed");
  const hash = checker.get(first.id).result.profileHash;
  assert.equal((await checker.status()).profile.hash, hash);
  assert.equal((await checker.start(job)).cached, true);
  assert.equal(calls, 1);
  await writeFile(cv, (await readFile(cv, "utf8")) + "\nISTQB Foundation certified.");
  assert.notEqual((await checker.status()).profile.hash, hash);
  checker.close();
});
