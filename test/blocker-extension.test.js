import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";

const text1 = "This job requires a full UK driving licence and regular client visits by car.";
const text2 = "This role requires occasional travel with public transport allowed for all visits.";
const waitFor = async (condition) => {
  for (let i = 0; i < 120; i++) { if (condition()) return; await new Promise((r) => setTimeout(r, 5)); }
  assert.ok(condition(), "Expected extension state did not arrive");
};
const load = async (window, path) => window.eval(await readFile(new URL(`../extension/${path}`, import.meta.url), "utf8"));
const fixture = async (initialStorage = {}) => {
  const dom = new JSDOM('<h2 data-testid="vj-job-title">Sales Advisor</h2><div data-testid="viewjob-job-content"><h3>Full job description</h3><div id="description">' + text1 + '</div></div><ul><li id="card"><a href="/viewjob?jk=first1111">Sales Advisor</a></li></ul>', { url: "https://uk.indeed.com/jobs?vjk=first1111", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window; let currentId = "first1111"; const calls = []; const storage = { ...initialStorage }; const listeners = [];
  Object.defineProperty(w.crypto, "subtle", { value: webcrypto.subtle }); w.TextEncoder = TextEncoder;
  w.fetch = async (url) => url.includes("/graphql") ? Response.json([{ data: { viewjob: { key: "second111", job: { key: "second111", description: { text: `*${text2}*` } } } } }]) : Response.json({ body: { jobInfoWrapperModel: { jobInfoModel: { sanitizedJobDescription: `<p>${text2}</p>` } } } });
  const postMessage = (data) => w.dispatchEvent(new w.MessageEvent("message", { data, source: w, origin: w.location.origin })); w.postMessage = postMessage;
  const realTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms) => realTimeout(fn, [120, 1200, 1500].includes(ms) ? 10 : ms);
  w.chrome = {
    runtime: { async sendMessage(message) {
      if (message.action === "status") return { ok: true, settings: { enabled: true, model: "test" }, session: { sharing: true }, profile: { hash: "profile" } };
      if (message.action === "check") {
        calls.push(message.body);
        const descriptionHash = [...new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(message.body.description)))].map((b) => b.toString(16).padStart(2, "0")).join("");
        return { ok: true, check: { status: "completed", result: { outcome: "no_blockers_found", findings: [], jobId: new URL(message.body.jobUrl).searchParams.get("jk"), descriptionHash, profileHash: "profile", model: "test", checkerVersion: 1, checkedAt: new Date().toISOString() } } };
      }
      return { ok: true };
    } },
    storage: { local: { async get() { return { ...storage }; }, async set(values) { Object.assign(storage, values); }, async remove(keys) { for (const key of keys) delete storage[key]; } }, onChanged: { addListener(fn) { listeners.push(fn); } } },
  };
  await load(w, "contracts/job-urls.js");
  await load(w, "contracts/blockers.js");
  await load(w, "extension-context.js");
  Object.assign(w.jobSearchCompanion.dom, { getRenderedRect: () => ({ width: 200, height: 100 }) });
  Object.assign(w.jobSearchCompanion.jobs, { resolveSelectedJobUrl: () => `https://uk.indeed.com/viewjob?jk=${currentId}`, collectJobs: () => [{ element: w.document.querySelector("a"), jobUrl: "https://uk.indeed.com/viewjob?jk=first1111" }] });
  w._initialData = { autoOpenTwoPaneJobKey: "first1111", autoOpenTwoPaneViewjobResponse: { body: { jobInfoWrapperModel: { jobInfoModel: { sanitizedJobDescription: `<p>${text1}</p>` } } } } };
  await load(w, "indeed-description-capture.js"); await load(w, "blocker-descriptions.js"); await load(w, "blocker-records.js"); await load(w, "blocker-renderer.js"); await load(w, "blocker-checker.js");
  return { w, calls, storage, listeners, select(id) { currentId = id; w.document.querySelector('h2').textContent = id; }, close: () => w.close() };
};

test("initial embedded descriptions produce one check and a visible result without fetching jobs", async () => {
  const f = await fixture();
  try {
    await waitFor(() => f.w.document.querySelector(".jsc-blocker-panel")?.textContent.includes("No blockers found"));
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].jobUrl, "https://uk.indeed.com/viewjob?jk=first1111");
    assert.equal(f.calls[0].description, text1); assert.ok(f.w.document.querySelector(".jsc-blocker-badge"));
    assert.equal(f.w.document.querySelector(".jsc-blocker-badge").textContent, "No blockers found");
  } finally { f.close(); }
});

test("a new selection with an old pane is never checked under the new job ID", async () => {
  const f = await fixture();
  try {
    await waitFor(() => f.calls.length === 1);
    f.select("second111");
    const previousFetch = f.w.fetch;
    f.w.fetch = (...args) => previousFetch(...args);
    await f.w.fetch("https://uk.indeed.com/viewjob?jk=second111");
    await waitFor(() => f.w.document.querySelector(".jsc-blocker-panel")?.textContent.includes("waiting for a full description"));
    assert.equal(f.calls.length, 1);
    f.w.document.querySelector("#description").textContent = text2;
    await waitFor(() => f.calls.length === 2);
    await waitFor(() => f.storage["blocker-result:second111"]);
    assert.equal(f.calls[1].jobUrl, "https://uk.indeed.com/viewjob?jk=second111"); assert.equal(f.calls[1].description, text2);
    assert.match(f.w.document.querySelector(".jsc-blocker-badge").textContent, /Previously checked/);
  } finally { f.close(); }
});

test("cached profile mismatches never display a current clean result", async () => {
  const f = await fixture({ "blocker-result:first1111": { jobId: "first1111", outcome: "clear_blocker", findings: [], descriptionHash: "old", profileHash: "old", model: "test", checkerVersion: 1, checkedAt: new Date().toISOString() } });
  try {
    await waitFor(() => f.w.document.querySelector(".jsc-blocker-badge")?.textContent.includes("Previously checked"));
    assert.ok(!f.w.document.querySelector(".jsc-blocker-panel")?.textContent.includes("Clear blocker"));
    await waitFor(() => f.w.document.querySelector(".jsc-blocker-panel")?.textContent.includes("No blockers found"));
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});


test("GraphQL selected descriptions are captured without inferring descriptions from search cards", async () => {
  const f = await fixture();
  try {
    await waitFor(() => f.storage["blocker-result:first1111"]);
    f.select("second111");
    await f.w.fetch("https://apis.indeed.com/graphql");
    f.w.document.querySelector("#description").textContent = text2;
    await waitFor(() => f.storage["blocker-result:second111"]);
    assert.equal(f.calls[1].description, `*${text2}*`);
    assert.equal(f.calls[1].jobUrl, "https://uk.indeed.com/viewjob?jk=second111");
  } finally { f.close(); }
});
