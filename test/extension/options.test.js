import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { waitUntil } from "../../test-support/async.js";
import { runScriptsInDom } from "../../test-support/extension-scripts.js";
import { JSDOM } from "jsdom";

test("settings use account registrations, save preferences, and clear only saved blocker checks", async (t) => {
  const dom = new JSDOM(
    await readFile(new URL("../../extension/options.html", import.meta.url), "utf8"),
    { url: "https://extension.test/options.html", runScripts: "outside-only" },
  );
  t.after(() => dom.window.close());
  const { window } = dom;
  let state = {
    settings: { enabled: false, model: "test", indexModel: null, accountFallback: false, reasoningEffort: "medium" },
    pausedReason: null,
    connectionStatus: {
      planUsageEnabled: true,
      connected: true,
      pending: false,
      activeId: "a",
      fallbackIds: ["b"],
      accounts: [
        { id: "a", label: "First account" },
        { id: "b", label: "second@example.test", email: "second@example.test" },
      ],
    },
    evidence: { hash: "evidence", cvIndexStatus: "pending" },
  };
  let models = [{ slug: "test", name: "Test model" }, { slug: "gpt-6-luna", name: "GPT-6 Luna" }, { slug: "gpt-6-sol", name: "GPT-6 Sol" }];
  const requests = [];
  const removed = [];
  window.chrome = {
    runtime: {
      async sendMessage(message) {
        requests.push(message);
        if (message.action === "models")
          return { ok: true, models };
        if (message.action === "settings")
          state = { ...state, settings: { ...state.settings, ...message.body } };
        return { ok: true, ...structuredClone(state) };
      },
    },
    storage: {
      onChanged: { addListener() {} },
      local: {
        async get() {
          return { "blocker-result:first111": {}, "applied-job:indeed:first111": {} };
        },
        async remove(keys) {
          removed.push(...keys);
        },
      },
    },
  };
  await runScriptsInDom(window, ["contracts/blockers.js", "contracts/inference-settings.js", "contracts/messages.js", "blockers/client.js", "blockers/result-store.js", "options.js"]);
  const element = (id) => window.document.getElementById(id);
  await waitUntil(() => element("saveSettings").textContent === "Saved");
  assert.match(element("evidence").textContent, /Profile loaded.*refresh on the next check/);
  state.evidence.cvIndexStatus = "current";
  assert.equal(element("currentAccount").value, "a");
  assert.equal(element("currentAccount").options[1].textContent, "second@example.test");
  assert.match(element("fallbackStatus").textContent, /second@example.test/);
  assert.equal(element("checkerReasoning").disabled, true);
  assert.match(element("reasoningHint").textContent, /default reasoning/);
  element("checkerModel").value = "gpt-6-luna";
  element("checkerModel").dispatchEvent(new window.Event("change"));
  assert.equal(element("checkerReasoning").disabled, false);
  assert.equal(element("reasoningHint").hidden, true);
  assert.match(element("checkerSpeed").textContent, /Fast requested.*unconfirmed/);
  element("indexModel").value = "gpt-6-sol";
  element("indexModel").dispatchEvent(new window.Event("change"));
  element("checkerReasoning").value = "low";
  element("checkerReasoning").dispatchEvent(new window.Event("change"));
  const catalogueRequests = requests.filter((request) => request.action === "models").length;
  element("refreshModels").click();
  await waitUntil(() => requests.filter((request) => request.action === "models").length > catalogueRequests && !element("saveSettings").disabled);
  assert.equal(element("checkerModel").value, "gpt-6-luna");
  assert.equal(element("indexModel").value, "gpt-6-sol");
  assert.equal(element("checkerReasoning").value, "low");
  element("checksEnabled").checked = true;
  element("checksEnabled").dispatchEvent(new window.Event("change"));
  element("saveSettings").click();
  await waitUntil(() => element("feedback").textContent === "Settings saved.");
  assert.equal(element("evidence").textContent, "Profile loaded. CV index is current.");
  assert.equal(requests.find((request) => request.action === "settings").body.enabled, true);
  assert.equal(requests.find((request) => request.action === "settings").body.reasoningEffort, "low");
  assert.equal(element("checkerReasoning").value, "low");
  assert.equal(requests.find((request) => request.action === "settings").body.indexModel, "gpt-6-sol");
  assert.equal(element("indexModel").value, "gpt-6-sol");
  await waitUntil(() => !element("saveSettings").disabled || element("saveSettings").textContent === "Saved");
  element("clearSavedChecks").click();
  await waitUntil(() => element("feedback").textContent === "Saved blocker checks cleared.");
  assert.deepEqual(removed, ["blocker-result:first111"]);
  // The checker placeholder cannot be selected by the user or silently saved.
  assert.equal(element("checkerModel").options[0].disabled, true);
  for (const id of ["checkerModel", "indexModel"]) {
    element(id).value = "";
    element(id).dispatchEvent(new window.Event("change"));
  }
  element("checksEnabled").checked = false;
  element("checksEnabled").dispatchEvent(new window.Event("change"));
  const beforeInvalidSave = requests.filter((request) => request.action === "settings").length;
  element("saveSettings").click();
  await waitUntil(() => element("feedback").textContent === "Choose an available checker model before saving.");
  assert.equal(requests.filter((request) => request.action === "settings").length, beforeInvalidSave);
  element("checkerModel").value = "gpt-6-luna";
  element("checkerModel").dispatchEvent(new window.Event("change"));
  element("saveSettings").click();
  await waitUntil(() => element("feedback").textContent === "Settings saved.");
  const body = requests.findLast((request) => request.action === "settings").body;
  assert.equal(body.enabled, false);
  assert.equal(body.accountFallback, false);
  assert.equal(body.indexModel, null);
  assert.equal(body.model, "gpt-6-luna");
  models = [{ slug: "test", name: "Test model" }];
  element("indexModel").value = "gpt-6-sol";
  element("indexModel").dispatchEvent(new window.Event("change"));
  element("refreshModels").click();
  await waitUntil(() => element("checkerModel").value === "" && element("checkerModel").selectedIndex === 0);
  assert.equal(element("indexModel").value, "");
  assert.equal(element("indexModel").selectedIndex, 0);
  assert.equal(element("checkerModel").options[0].disabled, true);
});


test("returning to settings detects a pause and preserves unsaved preferences", async (t) => {
  const dom = new JSDOM(await readFile(new URL("../../extension/options.html", import.meta.url), "utf8"),
    { url: "https://extension.test/options.html", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  const state = {
    settings: { enabled: true, model: "test", indexModel: null, accountFallback: false, reasoningEffort: "medium" },
    pausedReason: null,
    connectionStatus: { planUsageEnabled: true, connected: true, pending: false, activeId: "a", fallbackIds: [], accounts: [{ id: "a", label: "Account A" }] },
    evidence: { hash: "evidence" },
  };
  window.chrome = {
    runtime: { async sendMessage(message) {
      if (message.action === "models") return { ok: true, models: [{ slug: "test", name: "Test" }, { slug: "gpt-6-luna", name: "Luna" }] };
      return { ok: true, ...structuredClone(state) };
    } },
    storage: { local: { async get() { return {}; } }, onChanged: { addListener() {} } },
  };
  await runScriptsInDom(window, ["contracts/blockers.js", "contracts/inference-settings.js", "contracts/messages.js", "blockers/client.js", "blockers/result-store.js", "options.js"]);
  const element = (id) => window.document.getElementById(id);
  await waitUntil(() => element("saveSettings").textContent === "Saved");
  state.pausedReason = "Plan usage limit reached";
  window.dispatchEvent(new window.Event("focus"));
  await waitUntil(() => element("saveSettings").textContent === "Resume checks");
  assert.equal(element("saveSettings").disabled, false);
  element("checkerModel").value = "gpt-6-luna";
  element("checkerModel").dispatchEvent(new window.Event("change"));
  element("checkerReasoning").value = "low";
  element("checkerReasoning").dispatchEvent(new window.Event("change"));
  element("checksEnabled").checked = false;
  element("checksEnabled").dispatchEvent(new window.Event("change"));
  element("accountFallback").checked = true;
  element("accountFallback").dispatchEvent(new window.Event("change"));
  state.pausedReason = "Updated pause reason";
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  await waitUntil(() => element("feedback").textContent === "Updated pause reason");
  assert.equal(element("checkerModel").value, "gpt-6-luna");
  assert.equal(element("checkerReasoning").value, "low");
  assert.equal(element("checksEnabled").checked, false);
  assert.equal(element("accountFallback").checked, true);
  assert.equal(element("saveSettings").textContent, "Save settings");
});
