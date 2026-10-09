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
      profileHash: "profile",
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
          profile: { hash: "profile" },
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

const createBlockerFixture = async (initialStorage = {}) => {
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
  Object.defineProperty(window.crypto, "subtle", { value: webcrypto.subtle });
  window.TextEncoder = TextEncoder;
  window.fetch = async (url) => createDescriptionResponse(url);
  window.postMessage = (data) => window.dispatchEvent(new window.MessageEvent("message", {
    data,
    source: window,
    origin: window.location.origin,
  }));
  const realTimeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, milliseconds) =>
    realTimeout(callback, milliseconds === 100 ? 1 : [120, 1200, 1500].includes(milliseconds) ? 10 : milliseconds);
  const mocks = installChromeMocks(window, initialStorage);
  await runScriptsInDom(window, ["contracts/job-urls.js", "contracts/blockers.js", "contracts/messages.js", "blockers/client.js", "extension-context.js"]);
  Object.assign(window.jobSearchCompanion.dom, {
    getRenderedRect: () => ({ width: 200, height: 100 }),
  });
  Object.assign(window.jobSearchCompanion.jobs, {
    resolveSelectedJobUrl: () => `https://uk.indeed.com/viewjob?jk=${currentJobId}`,
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
    select(jobId) {
      currentJobId = jobId;
      window.document.querySelector("h2").textContent = jobId;
    },
    close: () => window.close(),
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
    fixture.close();
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
    fixture.close();
  }
});

test("cached profile mismatches never display a current clean result", async () => {
  const fixture = await createBlockerFixture({
    "blocker-result:first1111": {
      jobId: "first1111",
      outcome: "clear_blocker",
      findings: [],
      descriptionHash: "old",
      profileHash: "old",
      model: "test",
      reasoningEffort: null,
      checkerVersion: blockerContract.version,
      checkedAt: new Date().toISOString(),
    },
  });
  try {
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-badge")?.textContent.includes("Previously checked"));
    assert.ok(!fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("Confirmed blocker"));
    await waitUntil(() => fixture.window.document.querySelector(".jsc-blocker-panel")?.textContent.includes("No blockers found"));
    assert.equal(fixture.calls.length, 1);
  } finally {
    fixture.close();
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
    fixture.close();
  }
});
