import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEvidenceProvider } from "../../../bridge/blockers/evidence.js";

const fixture = async (context, cvIndex) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-evidence-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "profile.md");
  await writeFile(path, "## Personal Constraints\n- Provisional licence only.\n");
  return createEvidenceProvider({
    profileSources: [{ kind: "application", path }],
    cvIndex,
    indexPath: join(directory, "cv-index.json"),
    getIndexModel: () => "gpt-6-luna",
  });
};

test("saved evidence reads never prepare an index and share the prepared evidence identity", async (context) => {
  let savedIndex = null;
  let preparations = 0;
  const index = {
    fingerprint: "current-cvs",
    facts: [{ text: "Manual software testing at Example Ltd.", source: "CV: example.txt" }],
  };
  const provider = await fixture(context, {
    async readCurrent() { return savedIndex; },
    async ensureCurrent({ model, reasoningEffort }) {
      preparations += 1;
      assert.equal(model, "gpt-6-luna");
      assert.equal(reasoningEffort, "medium");
      savedIndex = index;
      return index;
    },
  });
  const before = await provider.readCurrent();
  assert.equal(preparations, 0);
  assert.equal(before.facts.length, 1);
  assert.equal(before.cvIndexStatus, "pending");
  const prepared = await provider.prepareCurrent();
  const saved = await provider.readCurrent();
  assert.equal(preparations, 1);
  assert.deepEqual(saved, prepared);
  assert.equal(saved.cvIndexStatus, "current");
  assert.notEqual(saved.hash, before.hash);
  assert.deepEqual(saved.facts.map((fact) => fact.id), ["F1", "CV1"]);
});

test("cancelling preparation aborts active index work and allows a fresh preparation", async (context) => {
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const provider = await fixture(context, {
    async readCurrent() { return null; },
    async ensureCurrent({ signal }) {
      calls += 1;
      assert.equal(signal.aborted, false);
      if (calls === 1) {
        started();
        await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return { fingerprint: "fresh", facts: [] };
    },
  });
  const pending = provider.prepareCurrent();
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await ready;
  provider.cancelPreparation();
  await rejected;
  assert.equal((await provider.readCurrent()).facts.length, 1);
  await provider.prepareCurrent();
  assert.equal(calls, 2);
});
