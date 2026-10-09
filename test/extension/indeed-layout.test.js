import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { runScriptsInDom } from "../../test-support/extension-scripts.js";

test("Indeed clearing server styles preserves a separate live client stylesheet", async () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    runScripts: "outside-only",
  });
  try {
    const { window } = dom;
    const { document } = window;
    await runScriptsInDom(window, ["indeed-layout.js"]);
    // Also exercise a second panel mounted by navigation within the page.
    for (let panel = 0; panel < 2; panel++) {
      const server = document.createElement("style");
      server.id = "react-native-stylesheet";
      server.setAttribute("data-rn-viewjob-server-styles", "");
      server.textContent = ".server-rule { display: flex; }";
      const container = document.createElement("div");
      container.append(server);
      document.body.append(container);
      await Promise.resolve();

      let client = document.getElementById("react-native-stylesheet");
      if (!client) {
        client = document.createElement("style");
        client.id = "react-native-stylesheet";
        document.head.append(client);
      }
      client.sheet.insertRule(`.client-${panel} { display: flex; }`, client.sheet.cssRules.length);
      server.innerHTML = "";
      assert.equal(client.parentNode, document.head);
      assert.equal(client.sheet.cssRules.length, panel + 1);
      assert.equal(server.sheet.cssRules.length, 0);
    }
  } finally {
    dom.window.close();
  }
});

test("startup leaves client styles and unrelated server styles alone", async () => {
  const dom = new JSDOM(`<!doctype html><html><head>
    <style id="react-native-stylesheet">.client { display: flex; }</style>
    </head><body><style id="other" data-rn-viewjob-server-styles>.server { display: block; }</style>
    </body></html>`, { runScripts: "outside-only" });
  try {
    await runScriptsInDom(dom.window, ["indeed-layout.js"]);
    assert.equal(dom.window.document.getElementById("react-native-stylesheet").sheet.cssRules.length, 1);
    assert.equal(dom.window.document.getElementById("other").sheet.cssRules.length, 1);
  } finally {
    dom.window.close();
  }
});
