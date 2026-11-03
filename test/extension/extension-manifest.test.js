import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));

test("extension and bridge versions stay synchronized", async () => {
  const [manifest, packageMetadata] = await Promise.all([
    readJson(new URL("../../extension/manifest.json", import.meta.url)),
    readJson(new URL("../../package.json", import.meta.url)),
  ]);

  assert.equal(manifest.version, packageMetadata.version);
});

test("every content script named by the extension manifest exists", async () => {
  const manifest = await readJson(new URL("../../extension/manifest.json", import.meta.url));
  const contentScriptPaths = manifest.content_scripts.flatMap(({ js = [] }) => js);

  await Promise.all(contentScriptPaths.map((path) => (
    access(new URL(`../../extension/${path}`, import.meta.url))
  )));
});

test("the declared service worker exists", async () => {
  const manifest = await readJson(new URL("../../extension/manifest.json", import.meta.url));
  await access(new URL(`../../extension/${manifest.background.service_worker}`, import.meta.url));
});

test("the extension runs on Indeed and LinkedIn", async () => {
  const manifest = await readJson(new URL("../../extension/manifest.json", import.meta.url));
  const matches = manifest.content_scripts.flatMap(({ matches: scriptMatches = [] }) => scriptMatches);

  assert.ok(matches.includes("https://*.indeed.com/*"));
  assert.ok(matches.includes("https://*.linkedin.com/*"));
});

test("content script paths are unique across execution worlds", async () => {
  const manifest = await readJson(new URL("../../extension/manifest.json", import.meta.url));
  const paths = manifest.content_scripts.flatMap(({ js }) => js);
  assert.equal(new Set(paths).size, paths.length);
});

test("Indeed description capture runs in the MAIN world at document start", async () => {
  const manifest = await readJson(new URL("../../extension/manifest.json", import.meta.url));
  const entry = manifest.content_scripts.find(({ js }) => js.includes("indeed-description-capture.bundle.js"));
  assert.deepEqual(entry.js, ["indeed-description-capture.bundle.js"]);
  assert.equal(entry.world, "MAIN");
  assert.equal(entry.run_at, "document_start");
  assert.ok(entry.matches.length > 0 && entry.matches.every((pattern) => pattern.includes("indeed.")));
  const bundle = await readFile(new URL("../../extension/indeed-description-capture.bundle.js", import.meta.url), "utf8");
  const capture = await readFile(new URL("../../extension/blockers/indeed-description-capture.js", import.meta.url), "utf8");
  assert.ok(bundle.endsWith(capture));
  for (const contract of ["jobUrls", "messages", "blockers"])
    assert.ok(bundle.slice(0, -capture.length).includes(`globalThis.jobSearchContracts.${contract} =`));
});

test("Indeed features follow common dependencies and are not injected on LinkedIn", async () => {
  const manifest = await readJson(new URL("../../extension/manifest.json", import.meta.url));
  const isolated = manifest.content_scripts.filter(({ world }) => world !== "MAIN");
  const common = isolated.find(({ js }) => js.includes("extension-context.js"));
  const indeed = isolated.find(({ js }) => js.includes("indeed-job-metadata.js"));
  assert.ok(isolated.indexOf(common) < isolated.indexOf(indeed));
  assert.ok(indeed.matches.every((pattern) => pattern.includes("indeed.")));
  for (const script of ["job-analysis-store.js", "page-decorations.js", "storage-observer.js"])
    assert.ok(common.js.includes(script));
  for (const script of ["indeed-job-metadata.js", "indeed-to-apply.js", "blockers/client.js", "blockers/checker.js", "blockers/renderer.js"])
    assert.ok(indeed.js.includes(script));
  assert.ok(common.js.every((script) => !script.startsWith("blockers/") && !script.startsWith("indeed-")));
  assert.ok(indeed.js.indexOf("blockers/renderer.js") < indeed.js.indexOf("blockers/checker.js"));
});

test("the suggestion card runs on HTTP and HTTPS in the isolated world", async () => {
  const manifest = await readJson(new URL("../../extension/manifest.json", import.meta.url));
  const entry = manifest.content_scripts.find(({ js }) => js.includes("suggestion-card.bundle.js"));
  assert.deepEqual(entry.js, ["suggestion-card.bundle.js"]);
  assert.deepEqual(entry.matches, ["http://*/*", "https://*/*"]);
  assert.equal(entry.world ?? "ISOLATED", "ISOLATED");
  assert.equal(entry.run_at, "document_idle");
});
