import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { runScriptsInVm } from "../../test-support/extension-scripts.js";

const makeRecord = (jobId, checkedAt = new Date().toISOString()) => ({
  jobId,
  checkerVersion: 1,
  outcome: "no_blockers_found",
  findings: [],
  descriptionHash: "description",
  profileHash: "profile",
  model: "test",
  checkedAt,
});

const createStoreFixture = async (initialStorage = {}) => {
  const storage = { ...initialStorage };
  const listeners = [];
  const notify = (changes, area = "local") => {
    for (const listener of listeners) listener(changes, area);
  };
  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          async get() { return { ...storage }; },
          async set(values) {
            Object.assign(storage, values);
            notify(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])));
          },
          async remove(keys) {
            for (const key of keys) delete storage[key];
            notify(Object.fromEntries(keys.map((key) => [key, {}])));
          },
        },
        onChanged: { addListener(listener) { listeners.push(listener); } },
      },
    },
  });
  await runScriptsInVm(context, ["contracts/blockers.js", "blocker-records.js"]);
  return { storage, notify, createStore: context.jobSearchBlockerRecords.createStore };
};

test("record stores synchronize saved findings and clearing preserves manual marks", async () => {
  const fixture = await createStoreFixture({
    "applied-job:indeed:first111": { appliedAt: "2026-10-01" },
    "blocker-result:expired111": makeRecord("expired111", "2000-01-01"),
  });
  const checkerStore = fixture.createStore();
  const settingsStore = fixture.createStore();
  const changes = [];
  checkerStore.subscribe((batch) => changes.push(...batch));
  await checkerStore.loadRecords();
  assert.equal(checkerStore.get("expired111"), undefined);

  await checkerStore.saveResult(makeRecord("first111"));
  assert.equal(settingsStore.get("first111").jobId, "first111");
  await settingsStore.clear();
  assert.equal(checkerStore.get("first111"), undefined);
  assert.ok(fixture.storage["applied-job:indeed:first111"]);
  assert.deepEqual(Object.keys(fixture.storage), ["applied-job:indeed:first111"]);
  assert.ok(changes.some(({ jobId, removed }) => jobId === "first111" && removed));
});

test("record-store notifications ignore unrelated storage and can be unsubscribed", async () => {
  const fixture = await createStoreFixture();
  const store = fixture.createStore();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  fixture.notify({ "blocker-result:first111": { newValue: makeRecord("first111") } }, "sync");
  fixture.notify({ "applied-job:indeed:first111": { newValue: {} } });
  assert.equal(notifications, 0);
  assert.equal(store.get("first111"), undefined);
  fixture.notify({ "blocker-result:first111": { newValue: makeRecord("first111") } });
  assert.equal(notifications, 1);
  unsubscribe();
  fixture.notify({ "blocker-result:first111": {} });
  assert.equal(notifications, 1);
  assert.equal(store.get("first111"), undefined);
});

test("saving results prunes surplus records while retaining the newest findings", async () => {
  const stored = Object.fromEntries(Array.from({ length: 300 }, (_, index) => {
    const jobId = `job${index}`;
    return [`blocker-result:${jobId}`, makeRecord(jobId, new Date(Date.now() - index * 1000).toISOString())];
  }));
  const fixture = await createStoreFixture(stored);
  const store = fixture.createStore();
  await store.loadRecords();
  await store.saveResult(makeRecord("newest111"));
  assert.equal(Object.keys(fixture.storage).length, 300);
  assert.equal(store.get("job299"), undefined);
  assert.equal(fixture.storage["blocker-result:job299"], undefined);
  assert.equal(store.get("newest111").jobId, "newest111");
});
