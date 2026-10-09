import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { waitUntil } from "../../test-support/async.js";
import { runScriptsInDom } from "../../test-support/extension-scripts.js";
import { JSDOM } from "jsdom";

test("settings use account registrations, save preferences, and clear only blocker findings", async (t) => {
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
        { id: "b", label: "Second account", email: "second@example.test" },
      ],
    },
    profile: { hash: "profile" },
  };
  const requests = [];
  const removed = [];
  window.chrome = {
    runtime: {
      async sendMessage(message) {
        requests.push(message);
        if (message.action === "models")
          return { ok: true, models: [{ slug: "test", name: "Test model" }, { slug: "gpt-6-luna", name: "GPT-6 Luna" }, { slug: "gpt-6-sol", name: "GPT-6 Sol" }] };
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
  await runScriptsInDom(window, ["contracts/blockers.js", "contracts/messages.js", "blockers/client.js", "blockers/result-store.js", "options.js"]);
  const element = (id) => window.document.getElementById(id);
  await waitUntil(() => element("saveSettings").textContent === "Saved");
  assert.equal(element("currentAccount").value, "a");
  assert.equal(element("currentAccount").options[1].textContent, "Second account");
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
  element("checksEnabled").checked = true;
  element("checksEnabled").dispatchEvent(new window.Event("change"));
  element("saveSettings").click();
  await waitUntil(() => element("feedback").textContent === "Settings saved.");
  assert.equal(requests.find((request) => request.action === "settings").body.enabled, true);
  assert.equal(requests.find((request) => request.action === "settings").body.reasoningEffort, "low");
  assert.equal(element("checkerReasoning").value, "low");
  assert.equal(requests.find((request) => request.action === "settings").body.indexModel, "gpt-6-sol");
  assert.equal(element("indexModel").value, "gpt-6-sol");
  await waitUntil(() => !element("saveSettings").disabled || element("saveSettings").textContent === "Saved");
  element("clearFindings").click();
  await waitUntil(() => element("feedback").textContent === "Saved findings cleared.");
  assert.deepEqual(removed, ["blocker-result:first111"]);
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
    profile: { hash: "profile" },
  };
  window.chrome = {
    runtime: { async sendMessage(message) {
      if (message.action === "models") return { ok: true, models: [{ slug: "test", name: "Test" }, { slug: "gpt-6-luna", name: "Luna" }] };
      return { ok: true, ...structuredClone(state) };
    } },
    storage: { local: { async get() { return {}; } }, onChanged: { addListener() {} } },
  };
  await runScriptsInDom(window, ["contracts/blockers.js", "contracts/messages.js", "blockers/client.js", "blockers/result-store.js", "options.js"]);
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
  state.pausedReason = "Updated pause reason";
  window.document.dispatchEvent(new window.Event("visibilitychange"));
  await waitUntil(() => element("feedback").textContent === "Updated pause reason");
  assert.equal(element("checkerModel").value, "gpt-6-luna");
  assert.equal(element("checkerReasoning").value, "low");
  assert.equal(element("saveSettings").textContent, "Save and resume checks");
});
