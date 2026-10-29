import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { runScriptsInDom } from "../../test-support/extension-scripts.js";
import { drainEventLoopUntil } from "../../test-support/async.js";

const render = async (t, blockerCheck, multiple = false) => {
  const dom = new JSDOM('<input id="typing">', { url: "https://example.org/", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  let root;
  const attachShadow = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function (options) { root = attachShadow.call(this, options); return root; };
  dom.window.chrome = { runtime: { sendMessage: async () => ({ ok: true, jobs: [{
    jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111", title: '<img src=x onerror="alert(1)"> Support',
    company: "Example", location: "London", pay: "£30,000", blockerCheck,
  }] }) } };
  if (multiple) {
    const send = dom.window.chrome.runtime.sendMessage;
    dom.window.chrome.runtime.sendMessage = async () => {
      const response = await send();
      response.jobs.push({ ...response.jobs[0], title: "Second local job", jobUrl: "https://uk.indeed.com/viewjob?jk=fixture222" });
      return response;
    };
  }
  dom.window.document.getElementById("typing").focus();
  await runScriptsInDom(dom.window, ["contracts/messages.js", "suggestion-card.js"]);
  await drainEventLoopUntil(() => Boolean(root?.querySelector("article")), { message: "Card did not render" });
  return { root, document: dom.window.document };
};

test("the extension card preserves typing focus, escapes website text and offers all requested actions", async (t) => {
  const { root, document } = await render(t, { status: "completed", findings: [
    { requirementQuote: "Driving licence required", explanation: "No licence is recorded." },
  ] });
  assert.equal(document.activeElement.id, "typing");
  assert.equal(document.getElementById("jsc-suggestion-host").shadowRoot, null);
  assert.equal(root.querySelector("img"), null);
  assert.equal(root.querySelector("summary").textContent, "1 potential blocker");
  assert.equal(root.querySelector("summary").parentElement.className, "has-blockers");
  assert.match(root.textContent, /Driving licence required/);
  const labels = [...root.querySelectorAll("button")].map((b) => b.textContent);
  assert.deepEqual(labels, ["Open job", "Analyse with CV Fit Advisor", "Mark as unsuitable", "Dismiss", "1 hour", "2 hours", "3 hours", "4 hours", "5 hours"]);
});

test("failed and incomplete checks never display a zero-blocker count", async (t) => {
  for (const status of ["unavailable", "incomplete"]) {
    const { root } = await render(t, { status });
    assert.ok(!root.textContent.includes("0 potential blockers"));
    assert.match(root.querySelector(".check-error").textContent, status === "incomplete" ? /incomplete/ : /failed or unavailable/);
  }
});

test("multiple suggestions use one compact top-right card with browsing controls", async (t) => {
  const { root, document } = await render(t, { status: "completed", findings: [] }, true);
  assert.equal(document.querySelectorAll("#jsc-suggestion-host").length, 1);
  assert.equal(root.querySelector("nav span").textContent, "1 of 2");
  assert.equal(root.querySelector('[aria-label="Previous suggested job"]').disabled, true);
  assert.equal(root.querySelector('[aria-label="Next suggested job"]').disabled, false);
});
