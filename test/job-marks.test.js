import assert from "node:assert/strict";
import test from "node:test";
import { flushUntil } from "../test-support/async.js";
import { click, createMenuFixture, isJobMarked } from "../test-support/menu-fixture.js";

for (const kind of ["applied", "unsuitable"]) {
  const timestamp = `${kind}At`;
  const title = kind[0].toUpperCase() + kind.slice(1);
  const createFixture = async (options) => {
    const fixture = await createMenuFixture(options);
    fixture.markButton = fixture[`${kind}Button`];
    return fixture;
  };
  const runtime = {
    sendMessage() {
      throw new Error("Job marks must not contact the bridge");
    },
  };
  const jobUrl = "https://uk.indeed.com/viewjob?jk=fixture111";
  const key = `${kind}-job:indeed:fixture111`;

  test(`${kind}: menu action persists a mark, survives reload and can be unmarked`, async () => {
    const first = await createFixture({ runtime });
    click(first.markButton);
    await flushUntil(() => first.toasts.length > 0);
    assert.equal(first.toasts.at(-1).textContent, `Marked as ${kind}.`);
    assert.equal(first.storage[key].jobUrl, jobUrl);
    assert.ok(Number.isFinite(Date.parse(first.storage[key][timestamp])));
    assert.equal(
      first.markButton.querySelector(".jsc-menu-item-label").textContent,
      `Unmark as ${kind}`,
    );
    assert.equal(first.markButton.disabled, false);

    const reloaded = await createFixture({ runtime, initialStorage: first.storage });

    assert.equal(isJobMarked(reloaded, jobUrl, kind), true);
    click(reloaded.markButton);
    await flushUntil(() => reloaded.toasts.length > 0);
    assert.equal(reloaded.toasts.at(-1).textContent, `${title} mark removed.`);
    assert.equal(reloaded.storage[key], undefined);
    assert.equal(
      reloaded.markButton.querySelector(".jsc-menu-item-label").textContent,
      `Mark as ${kind}`,
    );
  });

  test(`${kind}: tracking parameters and country hosts share the platform job identity`, async () => {
    const fixture = await createFixture({
      runtime,
      initialStorage: { [key]: { [timestamp]: "2026-10-06T09:00:00.000Z" } },
    });

    assert.equal(
      isJobMarked(fixture, "https://www.indeed.com/jobs?vjk=fixture111&from=search", kind),
      true,
    );
    assert.equal(isJobMarked(fixture, "https://uk.indeed.com/viewjob?jk=otherjob111", kind), false);
  });

  test(`${kind}: LinkedIn marks persist independently from Indeed`, async () => {
    const fixture = await createFixture({
      runtime,
      jobUrl: "https://www.linkedin.com/jobs/view/4447780789/",
    });
    click(fixture.markButton);
    await flushUntil(() => fixture.toasts.length > 0);
    assert.ok(fixture.storage[`${kind}-job:linkedin:4447780789`][timestamp]);
    assert.equal(fixture.storage[key], undefined);
  });

  test(`${kind}: marking a second job never replaces an existing record`, async () => {
    const initialStorage = { [key]: { jobUrl, [timestamp]: "2026-10-06T09:00:00.000Z" } };
    const fixture = await createFixture({
      runtime,
      jobUrl: "https://uk.indeed.com/viewjob?jk=secondjob111",
      initialStorage,
    });
    click(fixture.markButton);
    await flushUntil(() => fixture.toasts.length > 0);
    assert.equal(fixture.storage[key][timestamp], "2026-10-06T09:00:00.000Z");
    assert.ok(fixture.storage[`${kind}-job:indeed:secondjob111`][timestamp]);
  });

  test(`${kind}: storage changes from other tabs update the local record cache`, async () => {
    const fixture = await createFixture({ runtime });

    fixture.storageChanges[0](
      { [key]: { newValue: { [timestamp]: "2026-10-06T09:00:00.000Z" } } },
      "local",
    );
    await flushUntil(() => isJobMarked(fixture, jobUrl, kind));
    assert.equal(isJobMarked(fixture, jobUrl, kind), true);
    fixture.storageChanges[0]({ [key]: {} }, "local");
    await flushUntil(() => !isJobMarked(fixture, jobUrl, kind));
    assert.equal(isJobMarked(fixture, jobUrl, kind), false);
  });

  test(`${kind}: failed storage writes do not claim success or change the record`, async () => {
    const fixture = await createFixture({ runtime });
    fixture.context.chrome.storage.local.set = async () => {
      throw new Error("Storage full");
    };
    click(fixture.markButton);
    await flushUntil(() => fixture.toasts.length > 0);
    assert.equal(fixture.toasts.at(-1).role, "alert");
    assert.equal(fixture.storage[key], undefined);
    assert.equal(isJobMarked(fixture, jobUrl, kind), false);
    assert.equal(fixture.markButton.disabled, false);
  });

  test(`${kind}: an open menu keeps the job captured when it was opened`, async () => {
    const fixture = await createFixture({ runtime });
    fixture.context.jobSearchCompanion.jobs.consumeMenuJobUrl = () =>
      "https://uk.indeed.com/viewjob?jk=secondjob111";
    click(fixture.markButton);
    await flushUntil(() => fixture.toasts.length > 0);
    assert.ok(fixture.storage[key]);
    assert.equal(fixture.storage[`${kind}-job:indeed:secondjob111`], undefined);
  });
}
