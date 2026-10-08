import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(condition(), "Settings did not reach the expected state");
};
test("settings use account registrations, save preferences, and clear only blocker findings", async (t) => {
  const dom = new JSDOM(
    await readFile(new URL("../extension/options.html", import.meta.url), "utf8"),
    { url: "https://extension.test/options.html", runScripts: "outside-only" },
  );
  t.after(() => dom.window.close());
  const { window } = dom;
  let state = {
    settings: { enabled: false, model: "test", accountFallback: false },
    pausedReason: null,
    session: {
      sharing: true,
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
  window.eval(
    await readFile(new URL("../extension/contracts/blockers.js", import.meta.url), "utf8"),
  );
  window.eval(await readFile(new URL("../extension/options.js", import.meta.url), "utf8"));
  const element = (id) => window.document.getElementById(id);
  await waitFor(() => element("save").textContent === "Saved");
  assert.equal(element("account").value, "a");
  assert.equal(element("account").options[1].textContent, "Second account");
  assert.match(element("fallbackStatus").textContent, /second@example.test/);
  element("enabled").checked = true;
  element("enabled").dispatchEvent(new window.Event("change"));
  element("save").click();
  await waitFor(() => element("feedback").textContent === "Settings saved.");
  assert.equal(requests.find((request) => request.action === "settings").body.enabled, true);
  await waitFor(() => !element("save").disabled || element("save").textContent === "Saved");
  element("clear").click();
  await waitFor(() => element("feedback").textContent === "Saved findings cleared.");
  assert.deepEqual(removed, ["blocker-result:first111"]);
});
