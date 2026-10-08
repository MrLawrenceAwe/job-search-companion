import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));

test("extension and bridge versions stay synchronized", async () => {
  const [manifest, packageMetadata] = await Promise.all([
    readJson(new URL("../extension/manifest.json", import.meta.url)),
    readJson(new URL("../package.json", import.meta.url)),
  ]);

  assert.equal(manifest.version, packageMetadata.version);
});

test("every content script named by the extension manifest exists", async () => {
  const manifest = await readJson(new URL("../extension/manifest.json", import.meta.url));
  const contentScriptPaths = manifest.content_scripts.flatMap(({ js = [] }) => js);

  await Promise.all(contentScriptPaths.map((path) => (
    access(new URL(`../extension/${path}`, import.meta.url))
  )));
});

test("the declared service worker exists", async () => {
  const manifest = await readJson(new URL("../extension/manifest.json", import.meta.url));
  await access(new URL(`../extension/${manifest.background.service_worker}`, import.meta.url));
});

test("the extension runs on Indeed and LinkedIn", async () => {
  const manifest = await readJson(new URL("../extension/manifest.json", import.meta.url));
  const matches = manifest.content_scripts.flatMap(({ matches: scriptMatches = [] }) => scriptMatches);

  assert.ok(matches.includes("https://*.indeed.com/*"));
  assert.ok(matches.includes("https://*.linkedin.com/*"));
});

test("MAIN-world description capture loads its platform contract before the observer", async () => {
  const manifest = await readJson(new URL("../extension/manifest.json", import.meta.url));
  const mainScripts = manifest.content_scripts.find(({ world }) => world === "MAIN").js;
  const contractIndex = mainScripts.indexOf("contracts/job-urls.js");
  assert.ok(contractIndex >= 0);
  assert.ok(contractIndex < mainScripts.indexOf("indeed-description-capture.js"));
});
