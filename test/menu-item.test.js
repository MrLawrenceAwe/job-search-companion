import assert from "node:assert/strict";
import test from "node:test";

import { flushUntil } from "../test-support/async.js";
import { click, createMenuFixture } from "../test-support/menu-fixture.js";

test("menu submits the resolved job and reports success", async () => {
  const messages = [];
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(message);
      callback(message.type === "GET_CV_FIT_TASK_STATUS"
        ? { ok: true, submission: { id: "submission-1", status: "submitted" } }
        : { ok: true, submission: { id: "submission-1", status: "submitting" } });
    },
  };
  const { button, toasts } = await createMenuFixture({ runtime });
  const status = button.querySelector(".jsc-menu-item-status");
  const shortcut = button.querySelector(".jsc-menu-item-shortcut");

  click(button);
  await flushUntil(() => toasts.length > 0);

  assert.equal(JSON.stringify(messages), JSON.stringify([
    {
      type: "SUBMIT_CV_FIT_TASK",
      jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111",
    },
    { type: "GET_CV_FIT_TASK_STATUS", submissionId: "submission-1" },
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
      callback(message.type === "GET_CV_FIT_TASK_STATUS"
        ? { ok: true, submission: { id: "submission-1", status: "submitted" } }
        : { ok: true, submission: { id: "submission-1", status: "submitting" } });
    },
  };
  const jobUrl = "https://www.linkedin.com/jobs/view/4447780789/";
  const { button, toasts } = await createMenuFixture({ runtime, jobUrl });

  click(button);
  await flushUntil(() => toasts.length > 0);

  assert.equal(messages[0].jobUrl, jobUrl);
  assert.equal(toasts.at(-1).textContent, "CV Fit Advisor task submitted.");
});

test("menu reports bridge errors and restores the action", async () => {
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      callback(message.type === "GET_CV_FIT_TASK_STATUS"
        ? { ok: true, submission: { id: "submission-1", status: "failed", error: "Codex UI changed" } }
        : { ok: true, submission: { id: "submission-1", status: "submitting" } });
    },
  };
  const { button, toasts } = await createMenuFixture({ runtime });

  click(button);
  await flushUntil(() => toasts.length > 0);

  assert.equal(
    toasts.at(-1).textContent,
    "Couldn’t confirm the CV Fit Advisor submission. Check Codex before retrying: Codex UI changed",
  );
  assert.equal(toasts.at(-1).role, "alert");
  assert.equal(button.disabled, false);
});

test("menu explains an interrupted submission after a bridge restart", async () => {
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      callback(message.type === "GET_CV_FIT_TASK_STATUS"
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
  await flushUntil(() => toasts.length > 0);

  assert.equal(
    toasts.at(-1).textContent,
    "Couldn’t confirm the CV Fit Advisor submission. Check Codex before retrying: The bridge restarted before this submission was confirmed",
  );
  assert.equal(toasts.at(-1).role, "alert");
});

test("menu reports when mismatched settings leave a draft ready for review", async () => {
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      callback(message.type === "GET_CV_FIT_TASK_STATUS"
        ? { ok: true, submission: { id: "submission-1", status: "ready_for_review" } }
        : { ok: true, submission: { id: "submission-1", status: "submitting" } });
    },
  };
  const { button, toasts } = await createMenuFixture({ runtime });

  click(button);
  await flushUntil(() => toasts.length > 0);

  assert.equal(
    toasts.at(-1).textContent,
    "CV Fit Advisor draft is ready—check 6.1 Sol, Medium, and Fast in Codex, then send it.",
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
  await flushUntil(() => toasts.length > 0);

  assert.match(toasts.at(-1).textContent, /Couldn’t reach the Job Search Companion service/);
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

  context.document.querySelectorAll = () => [existingButton];
  context.jobSearchCompanion.dom.queryIncludingRoot = (root) => [root];

  assert.equal(context.jobSearchCompanion.jobMenu.insertJobMenuActions(newMenuRow), true);
  assert.ok(insertedButton);
  assert.notEqual(insertedButton, existingButton);
});
