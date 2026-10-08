import assert from "node:assert/strict";
import test from "node:test";
import { flushUntil } from "../test-support/async.js";
import { click, createMenuFixture, isJobMarked } from "../test-support/menu-fixture.js";

const runtime = {
  sendMessage() {
    throw new Error("Job marks must not contact the bridge");
  },
};
const jobUrl = "https://uk.indeed.com/viewjob?jk=fixture111";
const key = "unsuitable-job:indeed:fixture111";

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
  const fixture = await createMenuFixture({
    runtime,
    initialStorage: {
      [key]: { jobUrl, unsuitableAt: "2026-10-06T09:00:00.000Z" },
    },
  });

  const remove = fixture.context.chrome.storage.local.remove;
  fixture.context.chrome.storage.local.remove = async () => {
    throw new Error("Storage unavailable");
  };
  click(fixture.unsuitableButton);
  await flushUntil(() => fixture.toasts.length === 1);
  assert.equal(fixture.toasts.at(-1).role, "alert");
  assert.equal(isJobMarked(fixture, jobUrl, "unsuitable"), true);
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
    await new Promise((resolve) => {
      release = resolve;
    });
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
  const marks = fixture.context.jobSearchCompanion.jobMarks;
  const detailButton = marks.createButton(jobUrl, "unsuitable");
  const secondJob = "https://uk.indeed.com/viewjob?jk=secondjob111";
  let release;
  const set = fixture.context.chrome.storage.local.set;
  fixture.context.chrome.storage.local.set = async (values) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    await set(values);
  };
  click(detailButton);
  await flushUntil(() => release);
  detailButton.dataset.jobUrl = secondJob;
  release();
  await flushUntil(() => fixture.toasts.length > 0);
  assert.equal(detailButton.dataset.jobUrl, secondJob);
  assert.equal(detailButton.textContent, "Mark as unsuitable");
  assert.ok(fixture.storage[key].unsuitableAt);
  assert.equal(fixture.storage["unsuitable-job:indeed:secondjob111"], undefined);
});
