import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { dataDirectory } from "../shared/data-directory.js";
import { atomicWrite, readOptionalFile } from "../shared/filesystem.js";
import { recommendationContract as contract, blockerContract, jobUrlContract } from "../shared/contracts.js";

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
      const url = new URL(job.jobUrl);
      const { id } = jobUrlContract.identityFromUrl(url);
      if (seen.has(id)) continue;
      seen.add(id);
      const { title, company, location, pay, description, descriptionComplete } = job;
      jobs.push({ jobUrl: jobUrlContract.indeedJobUrl(url.origin, id),
        title, company, location, pay, description, descriptionComplete });
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

const unavailableSuggestions = () => ({ status: "unavailable", jobs: [] });
const suggestionMetadata = ({ description, descriptionComplete, ...metadata }) => metadata;

export const createSuggestionService = ({ checker, readBatch = readRecommendations, now = Date.now }) => {
  let batchStamp;
  const checks = new Map();

  const readBlockerCheck = async (job, jobId) => {
    if (!job.descriptionComplete || job.description.trim().length < blockerContract.limits.minimumDescriptionCharacters)
      return { status: "incomplete" };

    try {
      const prior = checks.get(jobId);
      let check;
      if (prior) {
        try { check = checker.get(prior.id); }
        catch { checks.delete(jobId); }
        if (["queued", "checking"].includes(check?.status) && now() - prior.startedAt > 120_000)
          check = { status: "failed" };
      }
      // Completed results must pass current evidence/settings validation again.
      if (!check || check.status === "completed") {
        check = await checker.start({ jobUrl: job.jobUrl, description: job.description });
        if (check.id) checks.set(jobId, { id: check.id, startedAt: now() });
        else checks.delete(jobId);
      }
      if (["queued", "checking"].includes(check.status)) return { status: "checking" };
      const result = check.result;
      if (check.status !== "completed" || !blockerContract.isRetainableResult(result) || result.jobId !== jobId)
        return { status: "unavailable" };

      return {
        status: "completed", outcome: result.outcome, checkedAt: result.checkedAt,
        descriptionHash: result.descriptionHash,
        evidenceHash: result.evidenceHash, model: result.model,
        reasoningEffort: result.reasoningEffort,
        findings: blockerContract.getRemainingFindings(result).map(({ requirementQuote, explanation }) => ({ requirementQuote, explanation })),
      };
    } catch {
      return { status: "unavailable" };
    }
  };

  return {
    async listSuggestions() {
      const batch = await readBatch();
      if (batch.status !== "ready") return unavailableSuggestions();
      return { status: "ready", collectedAt: batch.collectedAt, jobs: batch.jobs.map(suggestionMetadata) };
    },
    async checkSuggestion(jobId) {
      const batch = await readBatch();
      if (batch.status !== "ready") return { jobId, status: "unavailable" };
      if (batch.collectedAt !== batchStamp) {
        checks.clear();
        batchStamp = batch.collectedAt;
      }
      const job = batch.jobs.find(({ jobUrl }) => new URL(jobUrl).searchParams.get("jk") === jobId);
      const check = job ? await readBlockerCheck(job, jobId) : { status: "unavailable" };
      return { ...check, jobId };
    },
  };
};
