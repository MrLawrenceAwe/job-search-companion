import assert from "node:assert/strict";
import test from "node:test";
import { blockerContract } from "../shared/contracts.js";

const record = {
  checkerVersion: blockerContract.version,
  outcome: "no_blockers_found",
  findings: [],
  jobId: "first111",
  descriptionHash: "description",
  profileHash: "profile",
  model: "test",
  checkedAt: new Date().toISOString(),
};
test("shared blocker validation rejects expired, unknown and incomplete records", () => {
  assert.equal(blockerContract.isValidRecord(record), true);
  for (const patch of [
    { checkerVersion: -1 },
    { outcome: "toString" },
    { checkedAt: "invalid" },
    { model: null },
    { descriptionHash: null },
    { findings: null },
  ]) {
    assert.equal(blockerContract.isValidRecord({ ...record, ...patch }), false);
  }
  assert.equal(
    blockerContract.isValidRecord(
      record,
      Date.parse(record.checkedAt) + blockerContract.retentionMs,
    ),
    false,
  );
});
