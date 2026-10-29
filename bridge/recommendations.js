import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { dataDirectory } from "../shared/data-directory.js";
import { atomicWrite, readOptionalFile } from "../shared/filesystem.js";
import { recommendationContract as contract, blockerContract } from "../shared/contracts.js";

export const recommendationsPath = join(dataDirectory(), "recommendations.json");

export const saveRecommendations = async (input, { path = recommendationsPath, now = Date.now() } = {}) => {
  if (!["ready", "signed_out", "blocked", "unavailable"].includes(input?.status))
    throw new Error("Invalid feed status");
  const jobs = [];
  if (input.status === "ready") {
    if (input.signedIn !== true || input.feedHeading !== "Jobs for you"
      || !Array.isArray(input.jobs) || input.jobs.length > contract.maxJobs)
      throw new Error("A signed-in personalised feed is required");
    const seen = new Set();
    for (const job of input.jobs) {
      if (!contract.isFeedJob(job)) throw new Error("Invalid or incomplete Indeed recommendation");
      if (seen.has(job.jobUrl)) continue;
      seen.add(job.jobUrl);
      jobs.push(Object.fromEntries(["jobUrl", "title", "company", "location", "pay", "description", "descriptionComplete"].map((key) => [key, job[key]])));
    }
  }
  const batch = { status: input.status, collectedAt: new Date(now).toISOString(), jobs };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await atomicWrite(path, JSON.stringify(batch), 0o600);
  return batch;
};

export const readRecommendations = async ({ path = recommendationsPath, now = Date.now() } = {}) => {
  try {
    const batch = JSON.parse(await readOptionalFile(path));
    return contract.isFresh(batch, now) && batch.jobs.every(contract.isFeedJob) ? batch : { status: "unavailable", jobs: [] };
  } catch { return { status: "unavailable", jobs: [] }; }
};

// The list exposes metadata only; checking one selected card uses current CV evidence.
// Failed or pending checks remain visible as such, never as a zero-blocker result.
export const createSuggestionReader = ({ checker, readBatch = readRecommendations, now = Date.now }) => {
  let batchStamp;
  const checks = new Map();
  return async ({ jobId } = {}) => {
  const batch = await readBatch();
  if (batch.status !== "ready") return { status: "unavailable", jobs: [] };
  if (batch.collectedAt !== batchStamp) { checks.clear(); batchStamp = batch.collectedAt; }
  const jobs = [];
  for (const job of batch.jobs) {
    if (jobId && new URL(job.jobUrl).searchParams.get("jk") !== jobId) continue;
    const { description, descriptionComplete, ...card } = job;
    if (!jobId) { jobs.push(card); continue; }
    if (!descriptionComplete || description.trim().length < 40) {
      jobs.push({ ...card, blockerCheck: { status: "incomplete" } });
      continue;
    }
    try {
      const prior = checks.get(jobId);
      let check;
      if (prior) {
        check = checker.get(prior.id);
        if (["queued", "checking"].includes(check.status) && now() - prior.startedAt > 120_000)
          check = { status: "failed" };
      } else {
        check = await checker.start({ jobUrl: job.jobUrl, description: job.description });
        if (check.id) checks.set(jobId, { id: check.id, startedAt: now() });
      }
      if (["queued", "checking"].includes(check.status)) {
        jobs.push({ ...card, blockerCheck: { status: "checking" } });
        continue;
      }
      if (check.status !== "completed" || !blockerContract.isRetainableResult(check.result)
        || check.result.jobId !== jobId) {
        jobs.push({ ...card, blockerCheck: { status: "unavailable" } });
        continue;
      }
      jobs.push({ ...card, blockerCheck: {
        status: "completed", outcome: check.result.outcome, checkedAt: check.result.checkedAt,
        findings: blockerContract.getRemainingFindings(check.result).map(({ requirementQuote, explanation }) => ({ requirementQuote, explanation })),
      } });
    } catch { jobs.push({ ...card, blockerCheck: { status: "unavailable" } }); }
  }
  return { status: "ready", collectedAt: batch.collectedAt, jobs };
  };
};
