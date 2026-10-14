import { blockerContract } from "../../../shared/contracts.js";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { runScriptsInVm } from "../../../test-support/extension-scripts.js";

const makeRecord = (jobId, checkedAt = new Date().toISOString()) => ({
  jobId,
  checkerVersion: blockerContract.version,
  outcome: "no_blockers_found",
  findings: [],
  descriptionHash: "description",
  evidenceHash: "profile",
  model: "test",
  checkedAt,
});

const createStoreFixture = async (initialStorage = {}, readStorage, { maximumStoredRecords = Infinity } = {}) => {
  const storage = { ...initialStorage };
  const listeners = [];
  const notify = (changes, area = "local") => {
    for (const listener of listeners) listener(changes, area);
  };
  const context = vm.createContext({
    chrome: {
      storage: {
        local: {
          async get() { return readStorage ? readStorage() : { ...storage }; },
          async set(values) {
            if (Object.keys({ ...storage, ...values }).length > maximumStoredRecords)
              throw new Error("Storage quota exceeded");
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
  await runScriptsInVm(context, ["contracts/blockers.js", "blockers/result-store.js"]);
  return { storage, notify, createStore: context.jobSearchBlockerResults.createStore };
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
  await Promise.all([checkerStore.ready, settingsStore.ready]);
  assert.equal(checkerStore.get("expired111"), undefined);

  await checkerStore.saveResult(makeRecord("first111"));
  assert.equal(settingsStore.get("first111").jobId, "first111");
  await settingsStore.clear();
  assert.equal(checkerStore.get("first111"), undefined);
  assert.ok(fixture.storage["applied-job:indeed:first111"]);
  assert.deepEqual(Object.keys(fixture.storage), ["applied-job:indeed:first111"]);
  assert.ok(changes.some(({ jobId, removed }) => jobId === "first111" && removed));
});

test("initial storage reads cannot overwrite newer results or resurrect removed findings", async () => {
  let resolveRead;
  const fixture = await createStoreFixture({}, () => new Promise((resolve) => { resolveRead = resolve; }));
  const store = fixture.createStore();
  const changes = [];
  store.subscribe((batch) => changes.push(...batch));
  const latest = { ...makeRecord("first111"), outcome: "blocker", findings: [{ kind: "blocker", suggestedChallenge: "Please reconsider this finding against the advert." }] };
  fixture.notify({ "blocker-result:first111": { newValue: latest } });
  fixture.notify({ "blocker-result:second111": {} });
  resolveRead({
    "blocker-result:first111": makeRecord("first111"),
    "blocker-result:second111": makeRecord("second111"),
  });
  await store.ready;
  assert.equal(store.get("first111").outcome, "blocker");
  assert.equal(store.get("second111"), undefined);
  assert.deepEqual(changes.map(({ jobId, removed }) => ({ jobId, removed })), [
    { jobId: "first111", removed: false }, { jobId: "second111", removed: true },
  ]);
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
  await store.ready;
  assert.equal(notifications, 1);
  unsubscribe();
  fixture.notify({ "blocker-result:first111": {} });
  await store.ready;
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
  await store.ready;
  await store.saveResult(makeRecord("newest111"));
  assert.equal(Object.keys(fixture.storage).length, 300);
  assert.equal(store.get("job299"), undefined);
  assert.equal(fixture.storage["blocker-result:job299"], undefined);
  assert.equal(store.get("newest111").jobId, "newest111");
});

test("saving removes persisted expired findings before a quota-limited write", async () => {
  const expired = Object.fromEntries(Array.from({ length: 301 }, (_, index) => [
    `blocker-result:expired${index}`, makeRecord(`expired${index}`, "2000-01-01"),
  ]));
  const fixture = await createStoreFixture({
    ...expired,
    "applied-job:indeed:first111": { appliedAt: "2026-10-01" },
  }, undefined, { maximumStoredRecords: 2 });
  const store = fixture.createStore();
  await store.ready;
  await store.saveResult(makeRecord("newest111"));
  assert.deepEqual(Object.keys(fixture.storage).sort(), [
    "applied-job:indeed:first111", "blocker-result:newest111",
  ]);
});

test("finding overrides persist, synchronize, reject stale decisions and reset with fresh results", async () => {
  const fixture = await createStoreFixture();
  const first = fixture.createStore();
  const second = fixture.createStore();
  await Promise.all([first.ready, second.ready]);
  const result = { ...makeRecord("first111"), outcome: "blocker", findings: [
    { kind: "blocker", requirementQuote: "full UK driving licence", suggestedChallenge: "Does the advert permit alternative travel?" },
    { kind: "blocker", requirementQuote: "required experience", suggestedChallenge: "What experience evidence would resolve this finding?" },
  ], challengeReview: { accepted: false, requirementQuote: "full UK driving licence", response: "The full licence is still required." } };
  await first.saveResult(result);
  await assert.rejects(first.setFindingOverride(result, "required experience", true), /rejected challenge/);
  await first.setFindingOverride(result, "full UK driving licence", true);
  await Promise.resolve();
  assert.deepEqual(Array.from(second.get("first111").overriddenRequirementQuotes), ["full UK driving licence"]);
  const reopened = fixture.createStore();
  await reopened.ready;
  assert.deepEqual(Array.from(reopened.get("first111").overriddenRequirementQuotes), ["full UK driving licence"]);
  assert.equal(blockerContract.getRemainingFindings(reopened.get("first111")).length, 1);
  await second.setFindingOverride(second.get("first111"), "full UK driving licence", false);
  await Promise.resolve();
  assert.deepEqual(Array.from(first.get("first111").overriddenRequirementQuotes), []);
  await first.setFindingOverride(first.get("first111"), "full UK driving licence", true);
  const fresh = { ...result, checkedAt: new Date(Date.parse(result.checkedAt) + 1).toISOString() };
  await first.saveResult(fresh);
  await assert.rejects(first.setFindingOverride(result, "full UK driving licence", true), /check has changed/);
  assert.equal(first.get("first111").overriddenRequirementQuotes, undefined);
  const accepted = { ...fresh, challengeReview: { ...fresh.challengeReview, accepted: true } };
  await first.saveResult(accepted);
  await assert.rejects(first.setFindingOverride(accepted, "full UK driving licence", true), /rejected challenge/);
});
