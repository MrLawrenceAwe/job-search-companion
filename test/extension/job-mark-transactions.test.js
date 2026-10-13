import assert from "node:assert/strict";
import test from "node:test";
import { drainEventLoopUntil } from "../../test-support/async.js";
import { click, createMenuFixture, isJobMarked } from "../../test-support/menu-fixture.js";

const runtime = {
  sendMessage() {
    throw new Error("Job marks must not contact the bridge");
  },
};
const jobUrl = "https://uk.indeed.com/viewjob?jk=fixture111";

test("unsuitable and applied decisions preserve each other's saved records", async () => {
  const fixture = await createMenuFixture({ runtime });
  click(fixture.appliedButton);
  await drainEventLoopUntil(() => fixture.toasts.length === 1);
  click(fixture.unsuitableButton);
  await drainEventLoopUntil(() => fixture.toasts.length === 2);
  assert.ok(fixture.storage["applied-job:indeed:fixture111"].appliedAt);
  assert.ok(fixture.storage["unsuitable-job:indeed:fixture111"].unsuitableAt);
  click(fixture.unsuitableButton);
  await drainEventLoopUntil(() => fixture.toasts.length === 3);
  assert.equal(fixture.storage["unsuitable-job:indeed:fixture111"], undefined);
  assert.ok(fixture.storage["applied-job:indeed:fixture111"].appliedAt);
});

for (const kind of ["applied", "unsuitable"]) {
  const timestamp = `${kind}At`;
  const key = `${kind}-job:indeed:fixture111`;
  const createFixture = async (options) => {
    const fixture = await createMenuFixture(options);
    fixture.markButton = fixture[`${kind}Button`];
    return fixture;
  };

  test(`${kind}: failed removal keeps the mark and allows retry`, async () => {
    const fixture = await createFixture({
      runtime,
      initialStorage: {
        [key]: { jobUrl, [timestamp]: "2026-10-06T09:00:00.000Z" },
      },
    });

    const remove = fixture.context.chrome.storage.local.remove;
    fixture.context.chrome.storage.local.remove = async () => {
      throw new Error("Storage unavailable");
    };
    click(fixture.markButton);
    await drainEventLoopUntil(() => fixture.toasts.length === 1);
    assert.equal(fixture.toasts.at(-1).role, "alert");
    assert.equal(isJobMarked(fixture, jobUrl, kind), true);
    assert.equal(fixture.markButton.disabled, false);
    fixture.context.chrome.storage.local.remove = remove;
    click(fixture.markButton);
    await drainEventLoopUntil(() => fixture.toasts.length === 2);
    assert.equal(fixture.storage[key], undefined);
  });

  test(`${kind}: repeated clicks while saving toggle a mark only once`, async () => {
    const fixture = await createFixture({ runtime });
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
    click(fixture.markButton);
    await drainEventLoopUntil(() => release);
    click(fixture.markButton);
    assert.equal(fixture.markButton.disabled, true);
    release();
    await drainEventLoopUntil(() => fixture.toasts.length > 0);
    assert.equal(writes, 1);
    assert.ok(fixture.storage[key][timestamp]);
    assert.equal(fixture.markButton.disabled, false);
  });

  test(`${kind}: a detail control retargeted during a write keeps its current job`, async () => {
    const fixture = await createFixture({ runtime });
    const marks = fixture.context.jobSearchCompanion.jobMarks;
    const detailButton = marks.createButton(jobUrl, kind);
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
    await drainEventLoopUntil(() => release);
    detailButton.dataset.jobUrl = secondJob;
    release();
    await drainEventLoopUntil(() => fixture.toasts.length > 0);
    assert.equal(detailButton.dataset.jobUrl, secondJob);
    assert.equal(detailButton.textContent, `Mark as ${kind}`);
    assert.ok(fixture.storage[key][timestamp]);
    assert.equal(fixture.storage[`${kind}-job:indeed:secondjob111`], undefined);
  });
}
