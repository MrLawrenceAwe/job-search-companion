import { blockerContract } from "../../../shared/contracts.js";
import assert from "node:assert/strict";
import test from "node:test";
import { waitUntil } from "../../../test-support/async.js";
import { runScriptsInDom } from "../../../test-support/extension-scripts.js";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";

const drivingRequiredDescription = "This job requires a full UK driving licence and regular client visits by car.";
const publicTransportDescription = "This role requires occasional travel with public transport allowed for all visits.";



const createDescriptionResponse = (url) =>
  url.includes("/graphql")
    ? Response.json([{
        data: {
          viewjob: {
            key: "second111",
            job: { key: "second111", description: { text: `*${publicTransportDescription}*` } },
          },
        },
      }])
    : Response.json({
        body: {
          jobInfoWrapperModel: {
            jobInfoModel: { sanitizedJobDescription: `<p>${publicTransportDescription}</p>` },
          },
        },
      });

const createCompletedCheck = async ({ jobUrl, description }) => {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(description));
  const descriptionHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    status: "completed",
    result: {
      outcome: "no_blockers_found",
      findings: [],
      jobId: new URL(jobUrl).searchParams.get("jk"),
      descriptionHash,
      evidenceHash: "profile",
      model: "test",
      reasoningEffort: null,
      checkerVersion: blockerContract.version,
      checkedAt: new Date().toISOString(),
    },
  };
};

const installChromeMocks = (window, initialStorage) => {
  const calls = [];
  const storage = { ...initialStorage };
  const listeners = [];
  window.chrome = {
    runtime: {
      async sendMessage(message) {
        if (message.action === "status") return {
          ok: true,
          settings: { enabled: true, model: "test" },
          connectionStatus: { planUsageEnabled: true },
          evidence: { hash: "profile" },
        };
        if (message.action === "check") {
          calls.push(message.body);
          return { ok: true, check: await createCompletedCheck(message.body) };
        }
        return { ok: true };
      },
    },
    storage: {
      local: {
        async get() { return { ...storage }; },
        async set(values) { Object.assign(storage, values); },
        async remove(keys) {
          for (const key of keys) delete storage[key];
        },
      },
      onChanged: { addListener(listener) { listeners.push(listener); } },
    },
  };
  return { calls, storage, listeners };
};

const createBlockerFixture = async (initialStorage = {}, { initiallyHidden = false, dwellDelayMs = 10 } = {}) => {
  const dom = new JSDOM(`
    <h2 data-testid="vj-job-title">Sales Advisor</h2>
    <div data-testid="viewjob-job-content">
      <h3>Full job description</h3><div id="description">${drivingRequiredDescription}</div>
    </div>
    <ul><li id="card"><a href="/viewjob?jk=first1111">Sales Advisor</a></li></ul>
  `, {
    url: "https://uk.indeed.com/jobs?vjk=first1111",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  let currentJobId = "first1111";
  let hidden = initiallyHidden;
  Object.defineProperty(window.document, "hidden", { get: () => hidden });
  Object.defineProperty(window.document, "visibilityState", { get: () => hidden ? "hidden" : "visible" });
  const pendingDigests = new Set();
  Object.defineProperty(window.crypto, "subtle", { value: {
    digest(...args) {
      const pending = webcrypto.subtle.digest(...args).finally(() => pendingDigests.delete(pending));
      pendingDigests.add(pending);
      return pending;
    },
  } });
  window.TextEncoder = TextEncoder;
  window.fetch = async (url) => createDescriptionResponse(url);
  window.postMessage = (data) => window.dispatchEvent(new window.MessageEvent("message", {
    data,
    source: window,
    origin: window.location.origin,
  }));
  const realTimeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, milliseconds) =>
    realTimeout(callback, milliseconds === 1500 ? dwellDelayMs : milliseconds === 100 ? 1 : milliseconds === 120 ? 10 : milliseconds);
  const mocks = installChromeMocks(window, initialStorage);
  await runScriptsInDom(window, ["contracts/job-urls.js", "contracts/job-storage-keys.js", "contracts/blockers.js", "contracts/inference-settings.js", "contracts/messages.js", "blockers/client.js", "extension-context.js"]);
  Object.assign(window.jobSearchCompanion.dom, {
    getRenderedRect: () => ({ width: 200, height: 100 }),
  });
  Object.assign(window.jobSearchCompanion.jobs, {
    resolvePageJobUrl: () => `https://uk.indeed.com/viewjob?jk=${currentJobId}`,
    collectJobCarriers: () => [{
      element: window.document.querySelector("a"),
      jobUrl: "https://uk.indeed.com/viewjob?jk=first1111",
    }],
  });
  window._initialData = {
    autoOpenTwoPaneJobKey: "first1111",
    autoOpenTwoPaneViewjobResponse: {
      body: {
        jobInfoWrapperModel: {
          jobInfoModel: { sanitizedJobDescription: `<p>${drivingRequiredDescription}</p>` },
        },
      },
    },
  };
  await runScriptsInDom(window, [
    "blockers/indeed-description-capture.js",
    "blockers/indeed-description-store.js",
    "blockers/result-store.js",
    "page-decorations.js", "blockers/renderer.js",
    "blockers/checker.js",
  ]);
  return {
    window,
    ...mocks,
    setHidden(value) {
      hidden = value;
      window.document.dispatchEvent(new window.Event("visibilitychange"));
    },
    select(jobId) {
      currentJobId = jobId;
      window.document.querySelector("h2").textContent = jobId;
    },
    async close() {
      // Native crypto can outlive JSDOM timers; finish scans before destroying document.
      await Promise.allSettled([...pendingDigests]);
      // Let scan continuations finish before JSDOM removes window.document.
      await new Promise((resolve) => setImmediate(resolve));
      window.close();
    },
  };
};

test("initial embedded descriptions produce one check and a visible result without fetching jobs", async () => {
  const fixture = await createBlockerFixture();
  try {
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("No blockers found"));
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].jobUrl, "https://uk.indeed.com/viewjob?jk=first1111");
    assert.equal(fixture.calls[0].description, drivingRequiredDescription);
    assert.ok(fixture.window.document.querySelector(".jsc-blocker-badge"));
    assert.equal(fixture.window.document.querySelector(".jsc-blocker-badge").textContent, "No blockers found");
  } finally {
    await fixture.close();
  }
});

test("returning to the same job restarts a cancelled dwell without duplicate checks", async () => {
  const fixture = await createBlockerFixture({}, { dwellDelayMs: 100 });
  try {
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("Not checked yet"));
    fixture.setHidden(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(fixture.calls.length, 0);
    fixture.setHidden(false);
    await waitUntil(() => fixture.storage["blocker-result:first1111"]);
    assert.equal(fixture.calls.length, 1);
    fixture.setHidden(true);
    fixture.setHidden(false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(fixture.calls.length, 1);
  } finally {
    await fixture.close();
  }
});

test("a job first loaded in a hidden tab checks when it becomes visible", async () => {
  const fixture = await createBlockerFixture({}, { initiallyHidden: true });
  try {
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("Not checked yet"));
    assert.equal(fixture.calls.length, 0);
    fixture.setHidden(false);
    await waitUntil(() => fixture.storage["blocker-result:first1111"]);
    assert.equal(fixture.calls.length, 1);
  } finally {
    await fixture.close();
  }
});

test("a new selection with an old pane is never checked under the new job ID", async () => {
  const fixture = await createBlockerFixture();
  try {
    await waitUntil(() => fixture.calls.length === 1);
    fixture.select("second111");
    const previousFetch = fixture.window.fetch;
    fixture.window.fetch = (...args) => previousFetch(...args);
    await fixture.window.fetch("https://uk.indeed.com/viewjob?jk=second111");
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("waiting for a full description"));
    assert.equal(fixture.calls.length, 1);
    fixture.window.document.querySelector("#description").textContent = publicTransportDescription;
    await waitUntil(() => fixture.calls.length === 2);
    await waitUntil(() => fixture.storage["blocker-result:second111"]);
    assert.equal(fixture.calls[1].jobUrl, "https://uk.indeed.com/viewjob?jk=second111");
    assert.equal(fixture.calls[1].description, publicTransportDescription);
    assert.match(fixture.window.document.querySelector(".jsc-blocker-badge").textContent, /Previously checked/);
  } finally {
    await fixture.close();
  }
});

test("cached profile mismatches never display a current clean result", async () => {
  const fixture = await createBlockerFixture({
    "blocker-result:first1111": {
      jobId: "first1111",
      outcome: "blocker",
      findings: [{ kind: "blocker", suggestedChallenge: "Please reconsider whether this requirement blocks me using the full advert and my existing evidence.", requirementQuote: "Full UK licence required", explanation: "Only a provisional licence is documented.", evidenceFacts: [] }],
      descriptionHash: "old",
      evidenceHash: "old",
      model: "test",
      reasoningEffort: null,
      checkerVersion: blockerContract.version,
      checkedAt: new Date().toISOString(),
    },
  });
  try {
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-badge")?.textContent.includes("Previously checked"));
    assert.ok(!fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("Blocker"));
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("No blockers found"));
    assert.equal(fixture.calls.length, 1);
  } finally {
    await fixture.close();
  }
});

test("GraphQL selected descriptions are captured without inferring descriptions from search cards", async () => {
  const fixture = await createBlockerFixture();
  try {
    await waitUntil(() => fixture.storage["blocker-result:first1111"]);
    fixture.select("second111");
    await fixture.window.fetch("https://apis.indeed.com/graphql");
    fixture.window.document.querySelector("#description").textContent = publicTransportDescription;
    await waitUntil(() => fixture.storage["blocker-result:second111"]);
    assert.equal(fixture.calls[1].description, `*${publicTransportDescription}*`);
    assert.equal(fixture.calls[1].jobUrl, "https://uk.indeed.com/viewjob?jk=second111");
  } finally {
    await fixture.close();
  }
});

test("GraphQL Markdown escapes match rendered literal punctuation without accepting changed wording", async () => {
  const fixture = await createBlockerFixture();
  try {
    await waitUntil(() => fixture.storage["blocker-result:first1111"]);
    fixture.select("second111");
    const rendered = "Drafting letters and other communications.\\ b. Experience working in an HR department is required.";
    const markdown = rendered.replace("\\", "\\\\");
    // Supply the same response shape as Indeed's selected-job GraphQL payload.
    fixture.window.postMessage({
      type: fixture.window.jobSearchContracts.messages.indeedDescription,
      jobId: "second111",
      text: markdown,
    });
    fixture.window.document.querySelector("#description").textContent = rendered.replace("required", "optional");
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("waiting for a full description"));
    assert.equal(fixture.calls.length, 1);
    fixture.window.document.querySelector("#description").textContent = rendered;
    await waitUntil(() => fixture.storage["blocker-result:second111"]);
    assert.equal(fixture.calls[1].description, rendered);
    assert.equal(fixture.calls[1].jobUrl, "https://uk.indeed.com/viewjob?jk=second111");
  } finally {
    await fixture.close();
  }
});

test("GraphQL Markdown headings match the full rendered description without accepting changed wording", async () => {
  const fixture = await createBlockerFixture();
  try {
    await waitUntil(() => fixture.storage["blocker-result:first1111"]);
    fixture.select("second111");
    const markdown = "A customer service role based in London.\r\n\r\n## Requirements\r\nPrevious support experience is required.";
    fixture.window.postMessage({
      type: fixture.window.jobSearchContracts.messages.indeedDescription,
      jobId: "second111", text: markdown,
    });
    const description = fixture.window.document.querySelector("#description");
    description.innerHTML = '<p>A customer service role based in London.</p><h2>Requirements</h2><p>Previous support experience is optional.</p>';
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("waiting for a full description"));
    assert.equal(fixture.calls.length, 1);
    description.querySelector('p:last-child').textContent = 'Previous support experience is required.';
    await waitUntil(() => fixture.storage["blocker-result:second111"]);
    assert.equal(fixture.calls.length, 2);
    assert.equal(fixture.calls[1].jobUrl, "https://uk.indeed.com/viewjob?jk=second111");
    assert.match(fixture.calls[1].description, /Previous support experience is required\./);
  } finally {
    await fixture.close();
  }
});


test("cancelled checks retry the current job automatically", async () => {
  const fixture = await createBlockerFixture({}, { dwellDelayMs: 100 });
  try {
    const original = fixture.window.chrome.runtime.sendMessage;
    let starts = 0;
    fixture.window.chrome.runtime.sendMessage = async (message) => {
      if (message.action === "check" && ++starts === 1)
        return { ok: true, check: { id: "cancelled-check", status: "queued" } };
      if (message.action === "poll")
        return { ok: true, check: { id: "cancelled-check", status: "cancelled" } };
      return original(message);
    };
    await waitUntil(() => fixture.storage["blocker-result:first1111"]);
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("No blockers found"));
    assert.equal(starts, 2);
  } finally {
    await fixture.close();
  }
});


test("an essential evidence gap shows Potential blocker on the card and panel", async () => {
  const fixture = await createBlockerFixture({}, { initiallyHidden: true });
  try {
    const original = fixture.window.chrome.runtime.sendMessage;
    fixture.window.chrome.runtime.sendMessage = async (message) => {
      if (message.action !== "check") return original(message);
      const check = await createCompletedCheck(message.body);
      check.result.outcome = "blocker";
      check.result.findings = [
        { kind: "blocker", suggestedChallenge: "Please reconsider whether this requirement blocks me using the full advert and my existing evidence.", requirementQuote: "Three years repairing iPhones and Android devices is essential", explanation: "Your evidence does not establish three years repairing both device types.", evidenceFacts: [] },
      ];
      return { ok: true, check };
    };
    fixture.setHidden(false);
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-panel.jsc-blocker"));
    assert.equal(fixture.window.document.querySelector(".jsc-blocker-badge").textContent, "Potential blocker");
    const summaries = [...fixture.window.document.querySelectorAll(".jsc-blocker-finding summary")];
    assert.equal(summaries[0].querySelector("strong").textContent, "Potential blocker");
    assert.match(summaries[0].textContent, /Your evidence does not establish three years/);
    assert.equal(summaries.length, 1);
    const results = fixture.window.document.querySelector(".jsc-blocker-results");
    assert.equal(results.open, false);
    assert.match(results.querySelector("summary").textContent, /1 potential blocker/);
    assert.ok(fixture.window.document.querySelector(".jsc-blocker-panel > .jsc-blocker-controls"));
    results.open = true;
    fixture.window.jobSearchCompanion.pageDecorations.schedule();
    await new Promise((resolve) => fixture.window.setTimeout(resolve, 100));
    assert.equal(fixture.window.document.querySelector(".jsc-blocker-results").open, true);

    assert.equal(fixture.window.document.querySelector(".jsc-blocker-panel > strong").textContent, "Blocker check");
  } finally {
    await fixture.close();
  }
});

test("pending checks wait immediately and render a completed result without a polling sleep", async () => {
  const fixture = await createBlockerFixture({}, { initiallyHidden: true });
  try {
    const original = fixture.window.chrome.runtime.sendMessage;
    let release;
    let completed;
    let polls = 0;
    fixture.window.chrome.runtime.sendMessage = async (message) => {
      if (message.action === "check") {
        completed = await createCompletedCheck(message.body);
        return { ok: true, check: { id: "pending-check", status: "checking" } };
      }
      if (message.action === "poll") {
        polls++;
        return new Promise((resolve) => { release = () => resolve({ ok: true, check: completed }); });
      }
      return original(message);
    };
    fixture.setHidden(false);
    await waitUntil(() => release);
    assert.equal(polls, 1);
    assert.equal(fixture.storage["blocker-result:first1111"], undefined);
    release();
    await waitUntil(() => fixture.storage["blocker-result:first1111"]);
    assert.equal(polls, 1);
    assert.ok(fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("No blockers found"));
  } finally {
    await fixture.close();
  }
});

test("challenging a blocker sends the objection, shows the reply, and does not replay it on recheck", async () => {
  const fixture = await createBlockerFixture({}, { initiallyHidden: true });
  try {
    const original = fixture.window.chrome.runtime.sendMessage;
    const calls = [];
    fixture.window.chrome.runtime.sendMessage = async (message) => {
      if (message.action !== "check") return original(message);
      calls.push(message.body);
      const check = await createCompletedCheck(message.body);
      if (calls.length === 1) {
        check.result.outcome = "blocker";
        check.result.findings = [{ kind: "blocker", suggestedChallenge: "Please reconsider whether this requirement blocks me using the full advert and my existing evidence.", requirementQuote: "full UK driving licence", explanation: "Only a provisional licence is documented.", evidenceFacts: [] }];
      } else if (message.body.challenge) check.result.challengeReview = {
        accepted: true, profileUpdated: false, requirementQuote: message.body.challenge.requirementQuote,
        response: "The clarification resolves this job-specific blocker.",
      };
      return { ok: true, check };
    };
    fixture.setHidden(false);
    const doc = fixture.window.document;
    await waitUntil(() => doc.querySelector(".jsc-blocker-finding > button"));
    doc.querySelector(".jsc-blocker-finding > button").click();
    assert.equal(doc.querySelector(".jsc-blocker-challenge").hidden, false);
    const input = doc.querySelector(".jsc-blocker-challenge textarea");
    assert.equal(input.value, fixture.storage["blocker-result:first1111"].findings[0].suggestedChallenge);
    assert.equal(doc.activeElement, input);
    assert.equal(input.selectionStart, 0);
    assert.equal(input.selectionEnd, input.value.length);
    assert.equal(calls.length, 1, "opening the prepared suggestion makes no request");
    input.value = "The job allows non-driving travel elsewhere in the advert.";
    input.dispatchEvent(new fixture.window.Event("input"));
    doc.querySelector(".jsc-blocker-challenge button").click();
    await waitUntil(() => doc.querySelector(".jsc-blocker-review"));
    assert.equal(calls[1].challenge.reason, input.value);
    assert.match(doc.querySelector(".jsc-blocker-review").textContent, /Challenge accepted/);
    assert.doesNotMatch(doc.querySelector(".jsc-blocker-review").textContent, /clarification resolves/);
    assert.match(doc.querySelector(".jsc-blocker-badge").textContent, /No blockers found/);
    [...doc.querySelectorAll(".jsc-blocker-controls button")].find((node) => node.textContent === "Recheck").click();
    await waitUntil(() => calls.length === 3 && !doc.querySelector(".jsc-blocker-review") &&
      doc.querySelector(".jsc-blocker-panel")?.textContent.includes("No blockers found"));
    assert.equal(calls[2].challenge, undefined);
  } finally { await fixture.close(); }
});

test("check and recheck prepare selectable challenges that can be sent unchanged", async () => {
  const fixture = await createBlockerFixture({}, { initiallyHidden: true });
  try {
    const original = fixture.window.chrome.runtime.sendMessage;
    const calls = [];
    const suggestions = ["Does the advert allow travel without driving?", "What licence evidence would resolve this blocker?"];
    fixture.window.chrome.runtime.sendMessage = async (message) => {
      if (message.action !== "check") return original(message);
      calls.push(message.body);
      const check = await createCompletedCheck(message.body);
      if (!message.body.challenge) {
        check.result.outcome = "blocker";
        check.result.findings = [{ kind: "blocker", requirementQuote: "full UK driving licence",
          explanation: "Only a provisional licence is documented.", evidenceFacts: [],
          suggestedChallenge: suggestions[calls.length === 1 ? 0 : 1] }];
      }
      return { ok: true, check };
    };
    fixture.setHidden(false);
    const doc = fixture.window.document;
    await waitUntil(() => doc.querySelector(".jsc-blocker-finding > button"));
    for (const [index, suggestion] of suggestions.entries()) {
      doc.querySelector(".jsc-blocker-finding > button").click();
      const input = doc.querySelector(".jsc-blocker-challenge textarea");
      assert.equal(input.value, suggestion);
      assert.equal(input.selectionStart, 0);
      assert.equal(input.selectionEnd, suggestion.length);
      assert.equal(calls.length, index * 2 + 1);
      input.setSelectionRange(suggestion.length, suggestion.length);
      assert.equal(input.value, suggestion, "clearing selection keeps the suggestion");
      doc.querySelector(".jsc-blocker-challenge button").click();
      await waitUntil(() => doc.querySelector(".jsc-blocker-panel")?.textContent.includes("No blockers found"));
      assert.equal(calls.at(-1).challenge.reason, suggestion);
      if (index === 0) {
        [...doc.querySelectorAll(".jsc-blocker-controls button")].find((node) => node.textContent === "Recheck").click();
        await waitUntil(() => doc.querySelector(".jsc-blocker-finding > button"));
      }
    }
  } finally { await fixture.close(); }
});

test("selected suggestions can be deleted or replaced and cancelled edits survive reopening", async () => {
  const fixture = await createBlockerFixture({}, { initiallyHidden: true });
  try {
    const original = fixture.window.chrome.runtime.sendMessage;
    const calls = [];
    fixture.window.chrome.runtime.sendMessage = async (message) => {
      if (message.action !== "check") return original(message);
      calls.push(message.body);
      const check = await createCompletedCheck(message.body);
      if (!message.body.challenge) {
        check.result.outcome = "blocker";
        check.result.findings = [{ kind: "blocker", requirementQuote: "full UK driving licence",
          explanation: "Only a provisional licence is documented.", evidenceFacts: [],
          suggestedChallenge: "What evidence would resolve this licence finding?" }];
      }
      return { ok: true, check };
    };
    fixture.setHidden(false);
    const doc = fixture.window.document;
    await waitUntil(() => doc.querySelector(".jsc-blocker-finding > button"));
    const toggle = doc.querySelector(".jsc-blocker-finding > button");
    toggle.click();
    const input = doc.querySelector(".jsc-blocker-challenge textarea");
    const cancel = [...doc.querySelectorAll(".jsc-blocker-challenge button")].find((node) => node.textContent === "Cancel");
    input.setRangeText("", input.selectionStart, input.selectionEnd, "end");
    input.dispatchEvent(new fixture.window.Event("input"));
    cancel.click();
    toggle.click();
    assert.equal(input.value, "");
    doc.querySelector(".jsc-blocker-challenge button").click();
    assert.equal(calls.length, 1, "empty drafts cannot be sent");
    input.value = "I now hold a full UK driving licence.";
    input.dispatchEvent(new fixture.window.Event("input"));
    cancel.click();
    toggle.click();
    assert.equal(input.selectionStart, 0);
    assert.equal(input.selectionEnd, input.value.length);
    input.setRangeText("Please check whether alternative travel is allowed.", input.selectionStart, input.selectionEnd, "end");
    input.dispatchEvent(new fixture.window.Event("input"));
    doc.querySelector(".jsc-blocker-challenge button").click();
    await waitUntil(() => doc.querySelector(".jsc-blocker-panel")?.textContent.includes("No blockers found"));
    assert.equal(calls[1].challenge.reason, input.value);
  } finally { await fixture.close(); }
});

test("an accepted profile correction refreshes evidence and keeps its reply visible without another check", async () => {
  const fixture = await createBlockerFixture({}, { initiallyHidden: true });
  try {
    const original = fixture.window.chrome.runtime.sendMessage;
    let corrected = false;
    let starts = 0;
    fixture.window.chrome.runtime.sendMessage = async (message) => {
      if (message.action === "status") {
        const status = await original(message);
        if (corrected) status.evidence.hash = "profile-corrected";
        return status;
      }
      if (message.action !== "check") return original(message);
      starts++;
      const check = await createCompletedCheck(message.body);
      if (!message.body.challenge) {
        check.result.outcome = "blocker";
        check.result.findings = [{ kind: "blocker", suggestedChallenge: "Please reconsider whether this requirement blocks me using the full advert and my existing evidence.", requirementQuote: "full UK driving licence", explanation: "A full licence is not documented.", evidenceFacts: [] }];
      } else {
        corrected = true;
        check.result.evidenceHash = "profile-corrected";
        check.result.challengeReview = { accepted: true, profileUpdated: true, requirementQuote: "full UK driving licence", response: "Your full licence resolves the blocker." };
      }
      return { ok: true, check };
    };
    fixture.setHidden(false);
    const doc = fixture.window.document;
    await waitUntil(() => doc.querySelector(".jsc-blocker-finding > button"));
    doc.querySelector(".jsc-blocker-finding > button").click();
    const input = doc.querySelector("textarea");
    input.value = "I now hold a full UK driving licence.";
    input.dispatchEvent(new fixture.window.Event("input"));
    doc.querySelector(".jsc-blocker-challenge button").click();
    await waitUntil(() => doc.querySelector(".jsc-blocker-review")?.textContent.includes("profile has been updated"));
    assert.equal(fixture.storage["blocker-result:first1111"].evidenceHash, "profile-corrected");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(starts, 2);
    assert.match(doc.querySelector(".jsc-blocker-review").textContent, /Challenge accepted/);
    assert.doesNotMatch(doc.querySelector(".jsc-blocker-review").textContent, /full licence resolves/);
  } finally { await fixture.close(); }
});

test("a rejected challenge can be overridden and undone without changing evidence or hiding other blockers", async () => {
  const fixture = await createBlockerFixture({}, { initiallyHidden: true });
  try {
    const original = fixture.window.chrome.runtime.sendMessage;
    const calls = [];
    fixture.window.chrome.runtime.sendMessage = async (message) => {
      if (message.action !== "check") return original(message);
      calls.push(message.body);
      const check = await createCompletedCheck(message.body);
      check.result.outcome = "blocker";
      check.result.findings = [
        { kind: "blocker", requirementQuote: "full UK driving licence", explanation: "Only a provisional licence is documented.",
          evidenceFacts: [], suggestedChallenge: "Does this job allow alternative travel?" },
        { kind: "blocker", requirementQuote: "regular client visits by car", explanation: "Travel arrangements conflict with the requirement.",
          evidenceFacts: [], suggestedChallenge: "What evidence of travel availability would resolve this finding?" },
      ];
      if (message.body.challenge) check.result.challengeReview = {
        accepted: false, profileUpdated: false, requirementQuote: message.body.challenge.requirementQuote,
        response: "The advert still requires driving.",
      };
      return { ok: true, check };
    };
    fixture.setHidden(false);
    const doc = fixture.window.document;
    const button = (label) => [...doc.querySelectorAll(".jsc-blocker-panel button")].find((node) => node.textContent === label);
    await waitUntil(() => button("Challenge"));
    assert.equal(button("Override for this job"), undefined);
    button("Challenge").click();
    button("Send challenge").click();
    await waitUntil(() => button("Override for this job"));
    const prior = fixture.storage["blocker-result:first1111"];
    button("Override for this job").click();
    await waitUntil(() => button("Undo override"));
    assert.equal(calls.length, 2, "override makes no inference request");
    const overridden = fixture.storage["blocker-result:first1111"];
    assert.deepEqual(Array.from(overridden.overriddenRequirementQuotes), ["full UK driving licence"]);
    assert.equal(overridden.evidenceHash, prior.evidenceHash);
    assert.deepEqual(overridden.findings, prior.findings);
    assert.deepEqual(overridden.challengeReview, prior.challengeReview);
    assert.match(doc.querySelector(".jsc-blocker-review").textContent, /Finding retained.*still requires driving/);
    assert.match(doc.querySelector(".jsc-blocker-badge").textContent, /Potential blocker/);
    assert.equal(doc.querySelector(".jsc-blocker-results > summary").textContent,
      "1 potential blocker · Show findings");
    assert.equal(doc.querySelectorAll(".jsc-blocker-finding").length, 2);
    button("Undo override").click();
    await waitUntil(() => button("Override for this job"));
    assert.deepEqual(Array.from(fixture.storage["blocker-result:first1111"].overriddenRequirementQuotes), []);
    assert.equal(calls.length, 2);
  } finally { await fixture.close(); }
});

test("overriding the last rejected blocker labels the user's decision; recheck resets it", async () => {
  const fixture = await createBlockerFixture({}, { initiallyHidden: true });
  try {
    const original = fixture.window.chrome.runtime.sendMessage;
    const calls = [];
    fixture.window.chrome.runtime.sendMessage = async (message) => {
      if (message.action !== "check") return original(message);
      calls.push(message.body);
      const check = await createCompletedCheck(message.body);
      check.result.outcome = "blocker";
      check.result.findings = [{ kind: "blocker", requirementQuote: "full UK driving licence",
        explanation: "Only a provisional licence is documented.", evidenceFacts: [],
        suggestedChallenge: "Does this job allow alternative travel?" }];
      if (message.body.challenge) check.result.challengeReview = {
        accepted: false, profileUpdated: false, requirementQuote: "full UK driving licence", response: "A full licence is still required.",
      };
      return { ok: true, check };
    };
    fixture.setHidden(false);
    const doc = fixture.window.document;
    const button = (label) => [...doc.querySelectorAll(".jsc-blocker-panel button")].find((node) => node.textContent === label);
    await waitUntil(() => button("Challenge"));
    button("Challenge").click();
    button("Send challenge").click();
    await waitUntil(() => button("Override for this job"));
    button("Override for this job").click();
    await waitUntil(() => button("Undo override"));
    assert.match(doc.querySelector(".jsc-blocker-badge").textContent, /Blockers overridden by you/);
    assert.equal(doc.querySelector(".jsc-blocker-results > summary").textContent,
      "All blockers overridden by you · Show findings");
    assert.equal(doc.querySelector(".jsc-blocker-panel").classList.contains("jsc-blocker"), false);
    assert.equal(fixture.storage["blocker-result:first1111"].outcome, "blocker", "original AI outcome is retained");
    button("Recheck").click();
    await waitUntil(() => calls.length === 3 && button("Challenge") && !button("Undo override"));
    assert.equal(fixture.storage["blocker-result:first1111"].overriddenRequirementQuotes, undefined);
    assert.match(doc.querySelector(".jsc-blocker-badge").textContent, /Potential blocker/);
    assert.equal(doc.querySelector(".jsc-blocker-results > summary").textContent,
      "1 potential blocker · Show findings");
    assert.equal(button("Override for this job"), undefined, "the new check needs a rejected challenge before overriding");
  } finally { await fixture.close(); }
});

for (const failSecond of [false, true]) test(`challenges run in order with fresh evidence and preserved drafts${failSecond ? ' after a failed review' : ''}`, async () => {
  const fixture = await createBlockerFixture({}, { initiallyHidden: true });
  try {
    const { window } = fixture;
    const doc = window.document;
    const original = window.chrome.runtime.sendMessage;
    const quotes = ['full UK driving licence', 'regular client visits', 'car'];
    const findings = quotes.map((requirementQuote) => ({ kind: 'blocker', requirementQuote,
      explanation: 'The evidence does not establish this requirement.', evidenceFacts: [],
      suggestedChallenge: `Please reconsider ${requirementQuote}.` }));
    const requests = [];
    const releases = [];
    let evidenceHash = 'profile';
    window.chrome.runtime.sendMessage = async (message) => {
      if (message.action === 'status') {
        const response = await original(message);
        response.evidence.hash = evidenceHash;
        return response;
      }
      if (message.action !== 'check') return original(message);
      const check = await createCompletedCheck(message.body);
      check.result.outcome = 'blocker';
      check.result.findings = findings;
      if (!message.body.challenge) return { ok: true, check };
      requests.push({ ...message.body.challenge, evidenceHash });
      const index = requests.length - 1;
      return new Promise((resolve) => {
        releases[index] = () => {
          if (failSecond && index === 1) return resolve({ ok: false, error: 'Review failed. Try again.' });
          if (index === 0) evidenceHash = 'updated-profile';
          check.result.evidenceHash = evidenceHash;
          check.result.findings = findings.slice(index + 1);
          check.result.outcome = check.result.findings.length ? 'blocker' : 'no_blockers_found';
          check.result.challengeReview = { accepted: true, profileUpdated: index === 0,
            requirementQuote: quotes[index], response: 'Your clarification resolves this finding.' };
          resolve({ ok: true, check });
        };
      });
    };
    fixture.setHidden(false);
    const rows = () => [...doc.querySelectorAll('.jsc-blocker-finding')];
    const row = (quote) => rows().find((node) => node.querySelector('summary').textContent.includes(`“${quote}”`));
    const prepare = (quote, value) => {
      row(quote).querySelector(':scope > button').click();
      const input = row(quote).querySelector('textarea');
      input.value = value;
      input.dispatchEvent(new window.Event('input'));
      return input;
    };
    const send = (quote) => row(quote).querySelector('form button').click();
    await waitUntil(() => rows().length === 3);
    doc.querySelector('.jsc-blocker-results').open = true;
    prepare(quotes[0], 'First clarification');
    send(quotes[0]);
    await waitUntil(() => releases[0] && row(quotes[0]).querySelector(':scope > button').disabled);
    assert.equal(row(quotes[1]).querySelector(':scope > button').disabled, false);
    prepare(quotes[1], 'Second clarification');
    const oldForm = row(quotes[1]).querySelector('form');
    assert.equal(oldForm.querySelector('button').textContent, 'Queue challenge');
    send(quotes[1]);
    oldForm.dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitUntil(() => row(quotes[1]).querySelector(':scope > button').textContent === 'Challenge queued');
    assert.equal(requests.length, 1, 'queued work must not start during a review');
    const draft = prepare(quotes[2], 'Unfinished third clarification');
    draft.setSelectionRange(5, 9);
    releases[0]();
    await waitUntil(() => releases[1] && !row(quotes[0]));
    assert.equal(requests[1].evidenceHash, 'updated-profile');
    const restored = row(quotes[2]).querySelector('textarea');
    assert.equal(restored.value, 'Unfinished third clarification');
    assert.equal(restored.closest('form').hidden, false);
    assert.equal(doc.activeElement, restored);
    assert.equal(restored.selectionStart, 5);
    assert.equal(doc.querySelector('.jsc-blocker-results').open, true);
    send(quotes[2]);
    await waitUntil(() => row(quotes[2]).querySelector(':scope > button').textContent === 'Challenge queued');
    assert.equal(requests.length, 2);
    releases[1]();
    await waitUntil(() => releases[2]);
    assert.equal(requests[2].reason, 'Unfinished third clarification');
    assert.equal(requests[2].evidenceHash, 'updated-profile');
    releases[2]();
    await waitUntil(() => doc.querySelector('.jsc-blocker-results > summary').textContent.includes('No blockers found'));
    assert.deepEqual(requests.map((item) => item.requirementQuote), quotes);
    if (failSecond) assert.match(doc.querySelector('.jsc-blocker-panel').textContent, /Review failed/);
  } finally { await fixture.close(); }
});
