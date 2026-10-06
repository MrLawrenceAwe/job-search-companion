import assert from "node:assert/strict";
import test from "node:test";
import { click, createMenuFixture, flushUntil } from "../test-support/extension-vm.js";

const runtime = { sendMessage() { throw new Error("Application marks must not contact the bridge"); } };
const jobUrl = "https://uk.indeed.com/viewjob?jk=fixture111";
const key = "applied-job:indeed:fixture111";

test("applied menu action persists a mark, survives reload and can be unmarked", async () => {
  const first = await createMenuFixture({ runtime });
  click(first.appliedButton);
  await flushUntil(() => first.toasts.length > 0);
  assert.equal(first.toasts.at(-1).textContent, "Marked as applied.");
  assert.equal(first.storage[key].jobUrl, jobUrl);
  assert.ok(Number.isFinite(Date.parse(first.storage[key].appliedAt)));
  assert.equal(first.appliedButton.querySelector(".cv-fit-bridge-menu-item-label").textContent, "Unmark as applied");
  assert.equal(first.appliedButton.disabled, false);

  const reloaded = await createMenuFixture({ runtime, initialStorage: first.storage });
  await reloaded.context.cvFitBridge.jobMarks.ready;
  assert.equal(reloaded.context.cvFitBridge.jobMarks.isMarked(jobUrl, "applied"), true);
  click(reloaded.appliedButton);
  await flushUntil(() => reloaded.toasts.length > 0);
  assert.equal(reloaded.toasts.at(-1).textContent, "Applied mark removed.");
  assert.equal(reloaded.storage[key], undefined);
  assert.equal(reloaded.appliedButton.querySelector(".cv-fit-bridge-menu-item-label").textContent, "Mark as applied");
});

test("tracking parameters and country hosts share the platform job identity", async () => {
  const fixture = await createMenuFixture({
    runtime,
    initialStorage: { [key]: { appliedAt: "2026-10-06T09:00:00.000Z" } },
  });
  const applied = fixture.context.cvFitBridge.jobMarks;
  await applied.ready;
  assert.equal(applied.isMarked("https://www.indeed.com/jobs?vjk=fixture111&from=search", "applied"), true);
  assert.equal(applied.isMarked("https://uk.indeed.com/viewjob?jk=otherjob111", "applied"), false);
});

test("LinkedIn marks persist independently from Indeed", async () => {
  const fixture = await createMenuFixture({ runtime, jobUrl: "https://www.linkedin.com/jobs/view/4447780789/" });
  click(fixture.appliedButton);
  await flushUntil(() => fixture.toasts.length > 0);
  assert.ok(fixture.storage["applied-job:linkedin:4447780789"].appliedAt);
  assert.equal(fixture.storage[key], undefined);
});

test("marking a second job never replaces an existing record", async () => {
  const initialStorage = { [key]: { jobUrl, appliedAt: "2026-10-06T09:00:00.000Z" } };
  const fixture = await createMenuFixture({ runtime, jobUrl: "https://uk.indeed.com/viewjob?jk=secondjob111", initialStorage });
  click(fixture.appliedButton);
  await flushUntil(() => fixture.toasts.length > 0);
  assert.equal(fixture.storage[key].appliedAt, "2026-10-06T09:00:00.000Z");
  assert.ok(fixture.storage["applied-job:indeed:secondjob111"].appliedAt);
});

test("storage changes from other tabs update the local record cache", async () => {
  const fixture = await createMenuFixture({ runtime });
  const applied = fixture.context.cvFitBridge.jobMarks;
  await applied.ready;
  fixture.storageChanges[0]({ [key]: { newValue: { appliedAt: "2026-10-06T09:00:00.000Z" } } }, "local");
  await flushUntil(() => applied.isMarked(jobUrl, "applied"));
  assert.equal(applied.isMarked(jobUrl, "applied"), true);
  fixture.storageChanges[0]({ [key]: {} }, "local");
  await flushUntil(() => !applied.isMarked(jobUrl, "applied"));
  assert.equal(applied.isMarked(jobUrl, "applied"), false);
});

test("failed storage writes do not claim success or change the record", async () => {
  const fixture = await createMenuFixture({ runtime });
  fixture.context.chrome.storage.local.set = async () => { throw new Error("Storage full"); };
  click(fixture.appliedButton);
  await flushUntil(() => fixture.toasts.length > 0);
  assert.equal(fixture.toasts.at(-1).role, "alert");
  assert.equal(fixture.storage[key], undefined);
  assert.equal(fixture.context.cvFitBridge.jobMarks.isMarked(jobUrl, "applied"), false);
  assert.equal(fixture.appliedButton.disabled, false);
});

test("an open menu keeps the job captured when it was opened", async () => {
  const fixture = await createMenuFixture({ runtime });
  fixture.context.cvFitBridge.jobs.resolveJobUrl = () => "https://uk.indeed.com/viewjob?jk=secondjob111";
  click(fixture.appliedButton);
  await flushUntil(() => fixture.toasts.length > 0);
  assert.ok(fixture.storage[key]);
  assert.equal(fixture.storage["applied-job:indeed:secondjob111"], undefined);
});
