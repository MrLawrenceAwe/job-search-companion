import assert from "node:assert/strict";
import test from "node:test";
import { click, createMenuFixture, flushUntil } from "../test-support/extension-vm.js";

const runtime = { sendMessage() { throw new Error("Job marks must not contact the bridge"); } };
const jobUrl = "https://uk.indeed.com/viewjob?jk=fixture111";
const key = "unsuitable-job:indeed:fixture111";

test("unsuitable menu action persists a mark, survives reload and can be unmarked", async () => {
  const first = await createMenuFixture({ runtime });
  click(first.unsuitableButton);
  await flushUntil(() => first.toasts.length > 0);
  assert.equal(first.toasts.at(-1).textContent, "Marked as unsuitable.");
  assert.equal(first.storage[key].jobUrl, jobUrl);
  assert.ok(Number.isFinite(Date.parse(first.storage[key].unsuitableAt)));
  assert.equal(first.unsuitableButton.querySelector(".cv-fit-bridge-menu-item-label").textContent, "Unmark as unsuitable");
  assert.equal(first.unsuitableButton.disabled, false);

  const reloaded = await createMenuFixture({ runtime, initialStorage: first.storage });
  await reloaded.context.cvFitBridge.jobMarks.ready;
  assert.equal(reloaded.context.cvFitBridge.jobMarks.isMarked(jobUrl, "unsuitable"), true);
  click(reloaded.unsuitableButton);
  await flushUntil(() => reloaded.toasts.length > 0);
  assert.equal(reloaded.toasts.at(-1).textContent, "Unsuitable mark removed.");
  assert.equal(reloaded.storage[key], undefined);
  assert.equal(reloaded.unsuitableButton.querySelector(".cv-fit-bridge-menu-item-label").textContent, "Mark as unsuitable");
});

test("tracking parameters and country hosts share the platform job identity", async () => {
  const fixture = await createMenuFixture({
    runtime,
    initialStorage: { [key]: { unsuitableAt: "2026-10-06T09:00:00.000Z" } },
  });
  const unsuitable = fixture.context.cvFitBridge.jobMarks;
  await unsuitable.ready;
  assert.equal(unsuitable.isMarked("https://www.indeed.com/jobs?vjk=fixture111&from=search", "unsuitable"), true);
  assert.equal(unsuitable.isMarked("https://uk.indeed.com/viewjob?jk=otherjob111", "unsuitable"), false);
});

test("LinkedIn marks persist independently from Indeed", async () => {
  const fixture = await createMenuFixture({ runtime, jobUrl: "https://www.linkedin.com/jobs/view/4447780789/" });
  click(fixture.unsuitableButton);
  await flushUntil(() => fixture.toasts.length > 0);
  assert.ok(fixture.storage["unsuitable-job:linkedin:4447780789"].unsuitableAt);
  assert.equal(fixture.storage[key], undefined);
});

test("marking a second job never replaces an existing record", async () => {
  const initialStorage = { [key]: { jobUrl, unsuitableAt: "2026-10-06T09:00:00.000Z" } };
  const fixture = await createMenuFixture({ runtime, jobUrl: "https://uk.indeed.com/viewjob?jk=secondjob111", initialStorage });
  click(fixture.unsuitableButton);
  await flushUntil(() => fixture.toasts.length > 0);
  assert.equal(fixture.storage[key].unsuitableAt, "2026-10-06T09:00:00.000Z");
  assert.ok(fixture.storage["unsuitable-job:indeed:secondjob111"].unsuitableAt);
});

test("storage changes from other tabs update the local record cache", async () => {
  const fixture = await createMenuFixture({ runtime });
  const unsuitable = fixture.context.cvFitBridge.jobMarks;
  await unsuitable.ready;
  fixture.storageChanges[0]({ [key]: { newValue: { unsuitableAt: "2026-10-06T09:00:00.000Z" } } }, "local");
  await flushUntil(() => unsuitable.isMarked(jobUrl, "unsuitable"));
  assert.equal(unsuitable.isMarked(jobUrl, "unsuitable"), true);
  fixture.storageChanges[0]({ [key]: {} }, "local");
  await flushUntil(() => !unsuitable.isMarked(jobUrl, "unsuitable"));
  assert.equal(unsuitable.isMarked(jobUrl, "unsuitable"), false);
});

test("failed storage writes do not claim success or change the record", async () => {
  const fixture = await createMenuFixture({ runtime });
  fixture.context.chrome.storage.local.set = async () => { throw new Error("Storage full"); };
  click(fixture.unsuitableButton);
  await flushUntil(() => fixture.toasts.length > 0);
  assert.equal(fixture.toasts.at(-1).role, "alert");
  assert.equal(fixture.storage[key], undefined);
  assert.equal(fixture.context.cvFitBridge.jobMarks.isMarked(jobUrl, "unsuitable"), false);
  assert.equal(fixture.unsuitableButton.disabled, false);
});

test("an open menu keeps the job captured when it was opened", async () => {
  const fixture = await createMenuFixture({ runtime });
  fixture.context.cvFitBridge.jobs.resolveJobUrl = () => "https://uk.indeed.com/viewjob?jk=secondjob111";
  click(fixture.unsuitableButton);
  await flushUntil(() => fixture.toasts.length > 0);
  assert.ok(fixture.storage[key]);
  assert.equal(fixture.storage["unsuitable-job:indeed:secondjob111"], undefined);
});

test("unsuitable and applied decisions preserve each other's saved records", async () => {
  const fixture = await createMenuFixture({ runtime });
  click(fixture.appliedButton);
  await flushUntil(() => fixture.toasts.length === 1);
  click(fixture.unsuitableButton);
  await flushUntil(() => fixture.toasts.length === 2);
  assert.ok(fixture.storage["applied-job:indeed:fixture111"].appliedAt);
  assert.ok(fixture.storage[key].unsuitableAt);
  click(fixture.unsuitableButton);
  await flushUntil(() => fixture.toasts.length === 3);
  assert.equal(fixture.storage[key], undefined);
  assert.ok(fixture.storage["applied-job:indeed:fixture111"].appliedAt);
});

test("failed removal keeps the unsuitable mark and allows retry", async () => {
  const fixture = await createMenuFixture({ runtime, initialStorage: {
    [key]: { jobUrl, unsuitableAt: "2026-10-06T09:00:00.000Z" },
  } });
  await fixture.context.cvFitBridge.jobMarks.ready;
  const remove = fixture.context.chrome.storage.local.remove;
  fixture.context.chrome.storage.local.remove = async () => { throw new Error("Storage unavailable"); };
  click(fixture.unsuitableButton);
  await flushUntil(() => fixture.toasts.length === 1);
  assert.equal(fixture.toasts.at(-1).role, "alert");
  assert.equal(fixture.context.cvFitBridge.jobMarks.isMarked(jobUrl, "unsuitable"), true);
  assert.equal(fixture.unsuitableButton.disabled, false);
  fixture.context.chrome.storage.local.remove = remove;
  click(fixture.unsuitableButton);
  await flushUntil(() => fixture.toasts.length === 2);
  assert.equal(fixture.storage[key], undefined);
});

test("repeated clicks while saving toggle a decision only once", async () => {
  const fixture = await createMenuFixture({ runtime });
  let release;
  let writes = 0;
  const set = fixture.context.chrome.storage.local.set;
  fixture.context.chrome.storage.local.set = async (values) => {
    writes += 1;
    await new Promise((resolve) => { release = resolve; });
    await set(values);
  };
  click(fixture.unsuitableButton);
  await flushUntil(() => release);
  click(fixture.unsuitableButton);
  assert.equal(fixture.unsuitableButton.disabled, true);
  release();
  await flushUntil(() => fixture.toasts.length > 0);
  assert.equal(writes, 1);
  assert.ok(fixture.storage[key].unsuitableAt);
  assert.equal(fixture.unsuitableButton.disabled, false);
});

test("a detail control retargeted during a write keeps its current job", async () => {
  const fixture = await createMenuFixture({ runtime });
  const marks = fixture.context.cvFitBridge.jobMarks;
  const detailButton = marks.createButton(jobUrl, "unsuitable");
  const secondJob = "https://uk.indeed.com/viewjob?jk=secondjob111";
  let release;
  const set = fixture.context.chrome.storage.local.set;
  fixture.context.chrome.storage.local.set = async (values) => {
    await new Promise((resolve) => { release = resolve; });
    await set(values);
  };
  click(detailButton);
  await flushUntil(() => release);
  marks.updateButton(detailButton, secondJob, "unsuitable");
  release();
  await flushUntil(() => fixture.toasts.length > 0);
  assert.equal(detailButton.dataset.jobUrl, secondJob);
  assert.equal(detailButton.textContent, "Mark as unsuitable");
  assert.ok(fixture.storage[key].unsuitableAt);
  assert.equal(fixture.storage["unsuitable-job:indeed:secondjob111"], undefined);
});
