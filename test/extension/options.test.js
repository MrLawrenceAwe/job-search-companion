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
    settings: { enabled: false, model: "test", accountFallback: false },
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
          return { ok: true, models: [{ slug: "test", name: "Test model" }] };
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
  await runScriptsInDom(window, ["contracts/blockers.js", "contracts/messages.js", "blocker-client.js", "blocker-records.js", "options.js"]);
  const element = (id) => window.document.getElementById(id);
  await waitUntil(() => element("saveSettings").textContent === "Saved");
  assert.equal(element("currentAccount").value, "a");
  assert.equal(element("currentAccount").options[1].textContent, "Second account");
  assert.match(element("fallbackStatus").textContent, /second@example.test/);
  element("checksEnabled").checked = true;
  element("checksEnabled").dispatchEvent(new window.Event("change"));
  element("saveSettings").click();
  await waitUntil(() => element("feedback").textContent === "Settings saved.");
  assert.equal(requests.find((request) => request.action === "settings").body.enabled, true);
  await waitUntil(() => !element("saveSettings").disabled || element("saveSettings").textContent === "Saved");
  element("clearFindings").click();
  await waitUntil(() => element("feedback").textContent === "Saved findings cleared.");
  assert.deepEqual(removed, ["blocker-result:first111"]);
});
