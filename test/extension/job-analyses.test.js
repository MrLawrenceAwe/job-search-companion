import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { runScriptsInDom } from "../../test-support/extension-scripts.js";
import { waitUntil } from "../../test-support/async.js";

const jobUrl = "https://uk.indeed.com/viewjob?jk=fixture111";
const threadId = "01a11fef-d2cd-7410-953a-37e6497346d8";
const key = "analyzed-job:indeed:fixture111";
const record = { jobUrl, threadId, analyzedAt: "2026-10-09T09:00:00.000Z" };
const fixture = async (t, saved = {}) => {
  const dom = new JSDOM('<body><li id="card"><a id="job" href="/viewjob?jk=fixture111">Job</a></li><h1 data-testid="vj-job-title">Job</h1></body>', { url: jobUrl, runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  let storageChange;
  const messages = [];
  const toasts = [];
  window.chrome = {
    storage: { local: { get: async () => saved }, onChanged: { addListener: (fn) => { storageChange = fn; } } },
    runtime: { sendMessage: (message, callback) => { messages.push(message); callback({ ok: true }); } },
  };
  await runScriptsInDom(window, ["contracts/job-urls.js", "contracts/identifiers.js", "contracts/job-analyses.js", "contracts/messages.js", "extension-context.js"]);
  const companion = window.jobSearchCompanion;
  companion.dom.getRenderedRect = () => ({ width: 100, height: 30 });
  companion.jobs.collectJobCarriers = () => [{ element: window.document.querySelector("#job"), jobUrl }];
  companion.jobs.resolveSelectedJobUrl = () => jobUrl;
  companion.showToast = (...args) => toasts.push(args);
  await runScriptsInDom(window, ["page-decorations.js", "job-analyses.js"]);
  return { window, messages, toasts, change: (changes) => storageChange(changes, "local") };
};

test("a completed analysis renders on the card and detail pane and opens through the bridge", async (t) => {
  const { window, messages } = await fixture(t, { [key]: record });
  await waitUntil(() => window.document.querySelector(".jsc-analysis-detail"));
  const badge = window.document.querySelector(".jsc-analyzed-badge");
  assert.equal(badge.textContent, "Analysed · Open analysis");
  assert.equal(badge.dataset.threadId, threadId);
  assert.equal(window.document.querySelector(".jsc-analysis-detail").dataset.threadId, threadId);
  badge.click();
  assert.equal(JSON.stringify(messages.at(-1)), JSON.stringify({ type: "OPEN_JOB_ANALYSIS", jobUrl }));
  assert.equal(badge.disabled, false);
});

test("pending jobs have no analysed mark; storage updates and selection changes update controls", async (t) => {
  const { window, change, toasts } = await fixture(t);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(window.document.querySelector(".jsc-analysis-button"), null);
  change({ [key]: { newValue: record } });
  await waitUntil(() => window.document.querySelector(".jsc-analysis-detail"));
  window.chrome.runtime.sendMessage = (_, callback) => callback({ ok: false, error: "Bridge offline" });
  window.document.querySelector(".jsc-analysis-detail").click();
  assert.deepEqual(toasts, [["Bridge offline", "error"]]);
  window.jobSearchCompanion.jobs.resolveSelectedJobUrl = () => "https://uk.indeed.com/viewjob?jk=otherjob111";
  window.document.querySelector("h1").append(" changed");
  await waitUntil(() => !window.document.querySelector(".jsc-analysis-detail"));
  change({ [key]: { newValue: { ...record, threadId: "javascript:alert(1)" } } });
  await waitUntil(() => !window.document.querySelector(".jsc-analyzed-badge"));
});

for (const [verdict, color] of [["use as-is", "green"], ["edit the CV", "yellow"], ["do not apply yet", "red"], ["not enough information", "blue"]]) {
  test(`analysis verdict ${verdict} colours both controls ${color} and updates an existing badge`, async (t) => {
    const { window, change } = await fixture(t, { [key]: { ...record, verdict } });
    await waitUntil(() => window.document.querySelector(".jsc-analysis-detail"));
    for (const button of window.document.querySelectorAll(".jsc-analysis-button")) {
      assert.equal(button.dataset.verdictColor, color);
      assert.ok(button.title.startsWith(verdict));
      assert.equal(button.dataset.threadId, threadId);
    }
    const badge = window.document.querySelector(".jsc-analyzed-badge");
    change({ [key]: { newValue: { ...record, verdict: "edit the CV" } } });
    await waitUntil(() => badge.dataset.verdictColor === "yellow");
    assert.equal(window.document.querySelector(".jsc-analyzed-badge"), badge);
    assert.equal(window.document.querySelector(".jsc-analysis-detail").dataset.verdictColor, "yellow");
  });
}
