import assert from "node:assert/strict";
import test from "node:test";
import { jobStorageKeyContract as keys } from "../../shared/contracts.js";

test("job key helpers preserve the persisted schema used by existing records", () => {
  for (const [kind, platform, id, key] of [
    ["analysis", "indeed", "fixture111", "analyzed-job:indeed:fixture111"],
    ["analysis", "linkedin", "4447780789", "analyzed-job:linkedin:4447780789"],
    ["applied", "indeed", "fixture111", "applied-job:indeed:fixture111"],
    ["applied", "linkedin", "4447780789", "applied-job:linkedin:4447780789"],
    ["unsuitable", "indeed", "fixture111", "unsuitable-job:indeed:fixture111"],
    ["unsuitable", "linkedin", "4447780789", "unsuitable-job:linkedin:4447780789"],
    ["title", "indeed", "fixture111", "job-title:indeed:fixture111"],
    ["indeedApplied", "indeed", "fixture111", "indeed-applied-job:fixture111"],
    ["indeedDismissed", "indeed", "fixture111", "indeed-dismissed-job:fixture111"],
    ["indeedAvailability", "indeed", "fixture111", "indeed-job-availability:fixture111"],
  ]) {
    assert.equal(keys.forJob(kind, { platform, id }), key);
    assert.deepEqual(keys.parse(key), { kind, platform, id });
  }
});

test("unrelated or malformed storage cannot be treated as a job record", () => {
  for (const key of ["settings", "applied-job:indeed:short", "analyzed-job:other:fixture111",
    "job-title:indeed:fixture111:extra", "indeed-applied-job:", "analyzed-job:linkedin:123"]) {
    assert.equal(keys.parse(key), null);
  }
  assert.throws(() => keys.forJob("indeedApplied", { platform: "linkedin", id: "4447780789" }));
  assert.throws(() => keys.forJob("unknown", { platform: "indeed", id: "fixture111" }));
});
