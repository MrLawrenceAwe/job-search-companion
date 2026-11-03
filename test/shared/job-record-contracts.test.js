import assert from "node:assert/strict";
import test from "node:test";
import "../../extension/contracts/job-marks.js";
import "../../extension/contracts/indeed-availability.js";
import "../../extension/contracts/indeed-to-apply.js";

const { jobMarks, indeedAvailability, indeedToApply } = globalThis.jobSearchContracts;

test("manual mark readers agree on absent, empty and saved timestamps", () => {
  for (const [kind, field] of Object.entries(jobMarks.timestampFields)) {
    assert.equal(jobMarks.isRecord(kind, { [field]: "2026-10-19" }), true);
    for (const record of [undefined, {}, { [field]: "" }, { [field]: 123 }]) {
      assert.equal(jobMarks.isRecord(kind, record), false);
    }
  }
  assert.equal(jobMarks.isRecord("indeedApplied", { detectedAt: "2026-10-19" }), false);
});

test("active and expired availability share the same exact freshness boundary", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  for (const status of ["active", "expired"]) {
    const record = { status, checkedAt: new Date(now - indeedAvailability.freshnessMs).toISOString() };
    assert.equal(indeedAvailability.isRecord(record), true);
    assert.equal(indeedAvailability.isFresh(record, now - 1), true);
    assert.equal(indeedAvailability.isFresh(record, now), false);
  }
  for (const record of [undefined, {}, { status: "unknown", checkedAt: new Date(now).toISOString() },
    { status: "active", checkedAt: "invalid" }]) {
    assert.equal(indeedAvailability.isRecord(record), false);
    assert.equal(indeedAvailability.isFresh(record, now), false);
  }
});

test("expired listings remain refreshable while all display exclusions share one policy", () => {
  const expired = { status: "expired", checkedAt: "2026-10-19T12:00:00Z" };
  const records = { indeedAvailability: expired };
  const readRecord = (kind) => records[kind];
  assert.equal(indeedToApply.isExcludedFromRefresh(readRecord), false);
  assert.equal(indeedToApply.isExcludedFromDisplay(readRecord), true);
  records.indeedAvailability = { ...expired, status: "active" };
  assert.equal(indeedToApply.isExcludedFromDisplay(readRecord), false);
  for (const [kind, field] of Object.entries({ applied: "appliedAt", unsuitable: "unsuitableAt",
    indeedApplied: "detectedAt", indeedDismissed: "dismissedAt" })) {
    records[kind] = { [field]: "2026-10-19" };
    assert.equal(indeedToApply.isExcludedFromRefresh(readRecord), true);
    assert.equal(indeedToApply.isExcludedFromDisplay(readRecord), true);
    delete records[kind];
  }
});
