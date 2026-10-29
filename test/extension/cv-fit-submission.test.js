import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { drainEventLoopUntil } from "../../test-support/async.js";
import { click, createMenuFixture } from "../../test-support/menu-fixture.js";

test("menu submits the resolved job and reports success", async () => {
  const messages = [];
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(message);
      callback(message.type === "GET_CV_FIT_SUBMISSION_STATUS"
        ? { ok: true, submission: { id: "submission-1", status: "submitted" } }
        : { ok: true, submission: { id: "submission-1", status: "submitting" } });
    },
  };
  const { button, toasts } = await createMenuFixture({ runtime });
  const status = button.querySelector(".jsc-menu-item-status");
  const shortcut = button.querySelector(".jsc-menu-item-shortcut");

  click(button);
  await drainEventLoopUntil(() => toasts.length > 0);

  assert.equal(JSON.stringify(messages), JSON.stringify([
    {
      type: "SUBMIT_CV_FIT_TASK",
      jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111",
    },
    { type: "GET_CV_FIT_SUBMISSION_STATUS", submissionId: "submission-1" },
  ]));
  assert.equal(toasts.at(-1).textContent, "CV Fit Advisor task submitted.");
  assert.equal(toasts.at(-1).role, "status");
  assert.equal(button.disabled, false);
  assert.equal(button["aria-busy"], "false");
  assert.equal(status.textContent, "Submitting this job to Codex.");
  assert.equal(button.querySelector(".jsc-menu-item-label").textContent, "Analyse with CV Fit Advisor");
  assert.equal(button["aria-keyshortcuts"], "N");
  assert.equal(shortcut.textContent, "N");
  assert.equal(shortcut["aria-hidden"], "true");
});

test("LinkedIn menu submits a normalized LinkedIn job URL", async () => {
  const messages = [];
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(message);
      callback(message.type === "GET_CV_FIT_SUBMISSION_STATUS"
        ? { ok: true, submission: { id: "submission-1", status: "submitted" } }
        : { ok: true, submission: { id: "submission-1", status: "submitting" } });
    },
  };
  const jobUrl = "https://www.linkedin.com/jobs/view/4447780789/";
  const { button, toasts } = await createMenuFixture({ runtime, jobUrl });

  click(button);
  await drainEventLoopUntil(() => toasts.length > 0);

  assert.equal(messages[0].jobUrl, jobUrl);
  assert.equal(toasts.at(-1).textContent, "CV Fit Advisor task submitted.");
});

test("menu reports bridge errors and restores the action", async () => {
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      callback(message.type === "GET_CV_FIT_SUBMISSION_STATUS"
        ? { ok: true, submission: { id: "submission-1", status: "failed", error: "Codex UI changed" } }
        : { ok: true, submission: { id: "submission-1", status: "submitting" } });
    },
  };
  const { button, toasts } = await createMenuFixture({ runtime });

  click(button);
  await drainEventLoopUntil(() => toasts.length > 0);

  assert.equal(
    toasts.at(-1).textContent,
    "CV Fit Advisor submission failed: Codex UI changed",
  );
  assert.equal(toasts.at(-1).role, "alert");
  assert.equal(button.disabled, false);
});

test("menu explains an interrupted submission after a bridge restart", async () => {
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      callback(message.type === "GET_CV_FIT_SUBMISSION_STATUS"
        ? { ok: true, submission: {
          id: "submission-1",
          status: "interrupted",
          error: "The bridge restarted before this submission was confirmed",
        } }
        : { ok: true, submission: { id: "submission-1", status: "submitting" } });
    },
  };
  const { button, toasts } = await createMenuFixture({ runtime });

  click(button);
  await drainEventLoopUntil(() => toasts.length > 0);

  assert.equal(
    toasts.at(-1).textContent,
    "Couldn’t confirm the CV Fit Advisor submission. Check Codex before retrying: The bridge restarted before this submission was confirmed",
  );
  assert.equal(toasts.at(-1).role, "status");
  assert.equal(toasts.at(-1).dataset.kind, "warning");
});

test("menu reports when mismatched settings leave a draft ready for review", async () => {
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      callback(message.type === "GET_CV_FIT_SUBMISSION_STATUS"
        ? { ok: true, submission: { id: "submission-1", status: "ready_for_review" } }
        : { ok: true, submission: { id: "submission-1", status: "submitting" } });
    },
  };
  const { button, toasts, context } = await createMenuFixture({ runtime });
  context.jobSearchContracts.cvFitSettings = [
    { category: "Model", label: "Test model" },
    { category: "Effort", label: "High" },
    { category: "Speed", label: "Standard" },
  ];

  click(button);
  await drainEventLoopUntil(() => toasts.length > 0);

  assert.equal(
    toasts.at(-1).textContent,
    "CV Fit Advisor draft is ready—check Model: Test model, Effort: High, Speed: Standard in Codex, then send it.",
  );
  assert.equal(toasts.at(-1).role, "status");
});

test("menu reports a missing local bridge", async () => {
  const runtime = {
    lastError: null,
    sendMessage(_message, callback) {
      runtime.lastError = { message: "channel closed" };
      callback();
      runtime.lastError = null;
    },
  };
  const { button, toasts } = await createMenuFixture({ runtime });

  click(button);
  await drainEventLoopUntil(() => toasts.length > 0);

  assert.match(toasts.at(-1).textContent, /Couldn’t reach the Job Search Companion service/);
  assert.equal(toasts.at(-1).dataset.kind, "warning");
  assert.match(toasts.at(-1).textContent, /Check Codex before retrying/);
});

test("a rejected request reports failure without implying a task may be running", async () => {
  const runtime = {
    lastError: null,
    sendMessage(_message, callback) {
      callback({ ok: false, error: "Install the local bridge to enable CV-fit analysis. See the project setup guide." });
    },
  };
  const { button, toasts } = await createMenuFixture({ runtime });
  click(button);
  await drainEventLoopUntil(() => toasts.length > 0);
  assert.equal(toasts.at(-1).textContent, "CV Fit Advisor submission failed: Install the local bridge to enable CV-fit analysis. See the project setup guide.");
  assert.equal(toasts.at(-1).dataset.kind, "error");
  assert.equal(button.disabled, false);
});

test("a successful response without a submission ID preserves uncertainty", async () => {
  const runtime = {
    lastError: null,
    sendMessage(_message, callback) { callback({ ok: true }); },
  };
  const { button, toasts } = await createMenuFixture({ runtime });
  click(button);
  await drainEventLoopUntil(() => toasts.length > 0);
  assert.equal(toasts.at(-1).dataset.kind, "warning");
  assert.match(toasts.at(-1).textContent, /Check Codex before retrying.*did not return a submission ID/);
  assert.equal(button.disabled, false);
});

test("a visible action in another menu does not suppress insertion into this menu", async () => {
  const runtime = { lastError: null, sendMessage() {} };
  const { button: existingButton, context } = await createMenuFixture({ runtime });
  let insertedButton;
  const newMenuRow = {
    textContent: "WhatsApp",
    after(button) {
      insertedButton = button;
    },
  };

  context.document.querySelectorAll = (selector) => selector === ".jsc-menu-item" ? [existingButton] : [];
  context.jobSearchCompanion.dom.queryIncludingRoot = (root, selector) => selector === ".jsc-menu-item" ? [] : [root];

  assert.equal(context.jobSearchCompanion.jobMenu.insertJobMenuActions(newMenuRow), true);
  assert.ok(insertedButton);
  assert.notEqual(insertedButton, existingButton);
});

test("menu status text describes submission rather than opening", async () => {
  const source = await readFile(new URL("../../extension/cv-fit-submission.js", import.meta.url), "utf8");

  assert.match(source, /Submitting to Codex/);
  const client = await readFile(new URL("../../extension/cv-fit-client.js", import.meta.url), "utf8");
  assert.match(client, /CV Fit Advisor task submitted/);
  assert.doesNotMatch(source, /Opening CV Fit Advisor|task started in Codex/);
});

for (const outcome of ["unconfirmed", "polling_disconnected"]) {
  test(`menu warns without reporting failure when ${outcome}`, async () => {
    let sends = 0;
    const runtime = {
      lastError: null,
      sendMessage(message, callback) {
        if (message.type === "SUBMIT_CV_FIT_TASK") {
          sends += 1;
          callback({ ok: true, submission: { id: "submission-1", status: "submitting" } });
        } else if (outcome === "unconfirmed") {
          callback({ ok: true, submission: { id: "submission-1", status: "unconfirmed" } });
        } else {
          callback({ ok: false, error: "Connection lost" });
        }
      },
    };
    const { button, toasts } = await createMenuFixture({ runtime });
    click(button);
    await drainEventLoopUntil(() => toasts.length > 0);
    assert.equal(toasts.at(-1).dataset.kind, "warning");
    assert.equal(toasts.at(-1).role, "status");
    assert.match(toasts.at(-1).textContent, /check Codex before retrying/i);
    assert.equal(sends, 1);
    assert.equal(button.disabled, false);
  });
}
