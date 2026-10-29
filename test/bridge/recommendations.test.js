import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createSuggestionReader, readRecommendations, saveRecommendations } from "../../bridge/recommendations.js";
import { blockerContract } from "../../shared/contracts.js";
import { makeTemporaryDirectory } from "../../test-support/temporary-directory.js";

const job = { jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111", title: "Support advisor", company: "Example", location: "London", pay: "£30,000", description: "A full support job description with customer service responsibilities.", descriptionComplete: true };
const input = { status: "ready", signedIn: true, feedHeading: "Jobs for you", jobs: [job, job] };

test("personalised batches are private, deduplicated, expire and clear on sign-out", async (t) => {
  const directory = await makeTemporaryDirectory(t, "jsc-recommendations-");
  const path = join(directory, "feed.json");
  const now = Date.now();
  assert.deepEqual(await readRecommendations({ path }), { status: "unavailable", jobs: [] });
  await saveRecommendations(input, { path, now });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual((await readRecommendations({ path, now })).jobs, [job]);
  assert.equal((await readRecommendations({ path, now: now + 60 * 60_000 })).jobs.length, 0);
  assert.equal((await readRecommendations({ path, now: now - 1 })).jobs.length, 0);
  await saveRecommendations({ status: "signed_out", jobs: [job] }, { path, now });
  assert.equal((await readRecommendations({ path, now })).jobs.length, 0);
  await writeFile(path, "invalid json");
  assert.equal((await readRecommendations({ path, now })).jobs.length, 0);
});

test("generic searches, unsafe links and oversized feeds cannot enter the cache", async () => {
  for (const invalid of [
    { ...input, signedIn: false },
    { ...input, feedHeading: "Search results" },
    { ...input, jobs: Array(31).fill(job) },
    { ...input, jobs: [{ ...job, jobUrl: "https://evil.test/viewjob?jk=fixture111" }] },
    { ...input, jobs: [{ ...job, jobUrl: job.jobUrl + "&tracking=private" }] },
  ]) await assert.rejects(saveRecommendations(invalid));
});

test("cards carry completed blockers, pending checks, failures and incomplete descriptions truthfully", async () => {
  const batch = { status: "ready", collectedAt: new Date().toISOString(), jobs: [job] };
  const result = { checkerVersion: blockerContract.version, jobId: "fixture111", descriptionHash: "hash",
    evidenceHash: "evidence", model: "test-model", checkedAt: new Date().toISOString(), outcome: "blocker",
    findings: [{ kind: "blocker", requirementQuote: "Driving licence required", explanation: "No driving licence recorded.",
      suggestedChallenge: "Please reconsider this requirement.", evidenceFacts: [] }] };
  let calls = 0;
  const reader = createSuggestionReader({ readBatch: async () => batch, checker: {
    start: async () => { calls++; return { status: "completed", result }; },
  } });
  const list = await reader();
  assert.equal(calls, 0);
  assert.equal(list.jobs[0].description, undefined);
  const checked = await reader({ jobId: "fixture111" });
  assert.equal(checked.jobs[0].blockerCheck.status, "completed");
  assert.equal(checked.jobs[0].blockerCheck.findings.length, 1);
  assert.equal(checked.jobs[0].blockerCheck.findings[0].evidenceFacts, undefined);
  assert.equal((await reader({ jobId: "different111" })).jobs.length, 0);
  for (const status of ["queued", "checking", "failed", "cancelled"]) {
    const pending = createSuggestionReader({ readBatch: async () => batch, checker: { start: async () => ({ status }) } });
    assert.equal((await pending({ jobId: "fixture111" })).jobs[0].blockerCheck.status,
      ["queued", "checking"].includes(status) ? "checking" : "unavailable");
  }
  const failed = createSuggestionReader({ readBatch: async () => batch, checker: { start: async () => { throw new Error("private error"); } } });
  assert.equal((await failed({ jobId: "fixture111" })).jobs[0].blockerCheck.status, "unavailable");
  batch.jobs = [{ ...job, descriptionComplete: false, description: "Partial" }];
  assert.equal((await reader({ jobId: "fixture111" })).jobs[0].blockerCheck.status, "incomplete");
  assert.equal(calls, 1);
});

test("a failed background check is surfaced instead of restarted on every poll", async () => {
  let starts = 0;
  let status = "checking";
  const reader = createSuggestionReader({
    readBatch: async () => ({ status: "ready", collectedAt: "2026-10-29T19:00:00Z", jobs: [job] }),
    checker: {
      start: async () => { starts++; return { id: "check-1", status }; },
      get: () => ({ id: "check-1", status }),
    },
  });
  assert.equal((await reader({ jobId: "fixture111" })).jobs[0].blockerCheck.status, "checking");
  status = "failed";
  assert.equal((await reader({ jobId: "fixture111" })).jobs[0].blockerCheck.status, "unavailable");
  assert.equal((await reader({ jobId: "fixture111" })).jobs[0].blockerCheck.status, "unavailable");
  assert.equal(starts, 1);
});

test("completed check IDs are revalidated through current checker inputs", async () => {
  let current = 0;
  let starts = 0;
  const batch = { status: "ready", collectedAt: new Date().toISOString(), jobs: [job] };
  const reader = createSuggestionReader({ readBatch: async () => batch, checker: {
    start: async () => { starts++; return { id: `check-${current}`, status: "queued" }; },
    get: () => ({ status: "completed" }),
  } });
  await reader({ jobId: "fixture111" });
  // A profile correction or model change must reach start(), which owns freshness.
  current++;
  await reader({ jobId: "fixture111" });
  assert.equal(starts, 2);
});
