import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { blockerContract, jobUrlContract } from "../../shared/contracts.js";
import { sha256, hashJson } from "../../shared/sha256.js";
import { normalizeJobUrl } from "../job-url.js";
import { inferWithAccountFallback } from "./account-fallback.js";
import { runBlockerInference } from "./inference.js";
import { openPrivateStore } from "./private-store.js";
import { readVerifiedProfile } from "./profile.js";
import { openCvIndex } from "./cv-index.js";
import { openResultCache } from "./result-cache.js";

const { version: CHECKER_VERSION } = blockerContract;

export const openBlockerChecker = async ({
  directory,
  profileSources,
  cvDirectory,
  chatgpt,
  infer = runBlockerInference,
  readProfile: suppliedReadProfile,
}) => {
  const settings = await openPrivateStore(join(directory, "settings.json"), {
    enabled: false,
    model: null,
    indexModel: null,
    accountFallback: false,
    reasoningEffort: blockerContract.defaultReasoningEffort,
  });
  settings.value.indexModel ??= null;
  settings.value.accountFallback ??= false;
  settings.value.reasoningEffort ??= blockerContract.defaultReasoningEffort;
  const cache = await openResultCache(directory);
  const cvIndex = cvDirectory ? await openCvIndex({ directory, cvDirectory, chatgpt }) : null;
  let indexController = new AbortController();
  const readProfile = suppliedReadProfile || (async ({ refreshCvIndex = true } = {}) => {
    const profile = await readVerifiedProfile(profileSources);
    if (!cvIndex) return profile;
    if (indexController.signal.aborted) indexController = new AbortController();
    const index = refreshCvIndex
      ? await cvIndex.ensureCurrent({ signal: indexController.signal, model: settings.value.indexModel || settings.value.model, reasoningEffort: "medium" })
      : await cvIndex.readCurrent({ model: settings.value.indexModel || settings.value.model });
    if (!index) return { ...profile, hash: hashJson({ facts: profile.facts, cvFingerprint: null, indexModel: settings.value.indexModel || settings.value.model }) };
    const facts = [...profile.facts, ...index.facts.map((fact, i) => ({ ...fact, id: `CV${i + 1}` }))];
    return { facts, sources: [...profile.sources, { name: "CV experience index", path: join(directory, "cv-index.json") }],
      hash: hashJson({ facts, cvFingerprint: index.fingerprint }) };
  });
  const checksById = new Map();
  const checksByCacheKey = new Map();
  let queue = [];
  let runningCheck = null;
  let cancellationGeneration = 0;
  let pausedReason = null;
  let disposed = false;
  const cacheKeyFor = ({ jobId, descriptionHash, profile, model, reasoningEffort }) => hashJson({
    jobId, descriptionHash, profileHash: profile.hash,
    checkerVersion: CHECKER_VERSION, model, reasoningEffort,
  });
  const isCheckCurrent = (checkJob) =>
    checkJob.cancellationGeneration === cancellationGeneration &&
    checkJob.accountId === chatgpt.connectionStatus().activeId &&
    !disposed && !checkJob.controller?.signal.aborted;
  const pruneChecks = () => {
    for (const [id, checkJob] of checksById) {
      if (checksById.size <= 100) break;
      if (!["checking", "queued"].includes(checkJob.publicState.status)) checksById.delete(id);
    }
  };
  const releaseCheck = (checkJob) => {
    if (checksByCacheKey.get(checkJob.key) === checkJob) checksByCacheKey.delete(checkJob.key);
    delete checkJob.description;
    delete checkJob.profile;
  };
  const cancelQueuedCheck = (checkJob, error) => {
    checkJob.publicState.status = "cancelled";
    if (error) checkJob.publicState.error = error;
    releaseCheck(checkJob);
  };
  const cancelQueuedChecks = (error) => {
    for (const checkJob of queue) cancelQueuedCheck(checkJob, error);
    queue = [];
  };
  const status = async () => {
    let profile = null;
    let profileError = null;
    try {
      profile = await readProfile({ refreshCvIndex: false });
    } catch {
      profileError = "Verified profile unavailable. Check the local profile files.";
    }
    return {
      settings: settings.value,
      pausedReason,
      connectionStatus: chatgpt.connectionStatus(),
      profile: profile
        ? {
            hash: profile.hash,
            factCount: profile.facts.length,
            sources: profile.sources,
          }
        : null,
      profileError,
      queued: queue.length,
      running: Boolean(runningCheck),
    };
  };
  const runNextCheck = async () => {
    if (runningCheck || disposed || pausedReason || !settings.value.enabled || !queue.length) return;
    const checkJob = queue.shift();
    runningCheck = checkJob;
    checkJob.publicState.status = "checking";
    checkJob.accountId = chatgpt.connectionStatus().activeId;
    const controller = new AbortController();
    checkJob.controller = controller;
    const timer = setTimeout(() => controller.abort(), 90_000);
    let pendingRecord = null;
    let previousRecord = cache.get(checkJob.key);
    const isCurrent = () => isCheckCurrent(checkJob);
    try {
      if (cvIndex) {
        checkJob.profile = await readProfile();
        if (!isCurrent()) throw new Error("Check interrupted while preparing CV evidence.");
        checksByCacheKey.delete(checkJob.key);
        checkJob.key = cacheKeyFor(checkJob);
        checksByCacheKey.set(checkJob.key, checkJob);
        previousRecord = cache.get(checkJob.key);
        if (!checkJob.force && previousRecord) {
          checkJob.publicState.status = "completed";
          checkJob.publicState.result = previousRecord;
          return;
        }
      }
      const result = await inferWithAccountFallback({
        chatgpt,
        infer,
        checkJob,
        signal: controller.signal,
        isCurrent,
        enabled: () => settings.value.accountFallback,
      });
      if (!isCurrent()) {
        checkJob.publicState.status = "cancelled";
        return;
      }
      const record = {
        ...result,
        jobId: checkJob.jobId,
        descriptionHash: checkJob.descriptionHash,
        profileHash: checkJob.profile.hash,
        checkerVersion: CHECKER_VERSION,
        model: checkJob.model,
        reasoningEffort: checkJob.reasoningEffort,
        checkedAt: new Date().toISOString(),
      };
      pendingRecord = record;
      await cache.put(checkJob.key, record);
      if (!isCurrent()) {
        checkJob.publicState.status = "cancelled";
        return;
      }
      checkJob.publicState.status = "completed";
      checkJob.publicState.result = record;
    } catch (error) {
      if (pendingRecord) cache.restore(checkJob.key, pendingRecord, previousRecord);
      checkJob.publicState.status = !isCurrent() ? "cancelled" : "failed";
      checkJob.publicState.error = controller.signal.aborted
        ? "Check interrupted or timed out. Try again."
        : error.message;
      checkJob.publicState.code = error.code || "check_failed";
      if (
        isCurrent() &&
        (error.pauseChecks ||
          [401, 403, 429].includes(error.status) ||
          error.code === "subscription_sharing_unsupported_capability")
      ) {
        pausedReason = error.message;
        cancelQueuedChecks(pausedReason);
      }
    } finally {
      clearTimeout(timer);
      releaseCheck(checkJob);
      runningCheck = null;
      pruneChecks();
      void runNextCheck();
    }
  };
  const cancelAllChecks = () => {
    cancellationGeneration += 1;
    indexController.abort();
    cancelQueuedChecks();
    runningCheck?.controller.abort();
  };
  return {
    status,
    async configure(patch) {
      if (
        Object.keys(patch).some((key) => !["enabled", "model", "indexModel", "accountFallback", "reasoningEffort"].includes(key)) ||
        (patch.reasoningEffort !== undefined && !["low", "medium"].includes(patch.reasoningEffort)) ||
        ["enabled", "accountFallback"].some(
          (key) => patch[key] !== undefined && typeof patch[key] !== "boolean",
        )
      )
        throw new Error("Invalid checker settings");
      if (patch.model !== undefined || (patch.indexModel !== undefined && patch.indexModel !== null)) {
        const models = await chatgpt.models();
        if ([patch.model, patch.indexModel].filter((model) => model !== undefined && model !== null).some((model) => !models.some((m) => m.slug === model)))
          throw new Error("Choose a model available to the connected ChatGPT account");
      }
      if (patch.enabled && (!chatgpt.connectionStatus().planUsageEnabled || !(patch.model || settings.value.model)))
        throw new Error("Connect ChatGPT plan usage and choose a model first");
      if (patch.enabled && !(await readProfile({ refreshCvIndex: false })).facts.length)
        throw new Error("Verified profile unavailable");
      if (
        patch.enabled === false ||
        (patch.model && patch.model !== settings.value.model) ||
        (patch.indexModel !== undefined && patch.indexModel !== settings.value.indexModel) ||
        (patch.reasoningEffort !== undefined && patch.reasoningEffort !== settings.value.reasoningEffort) ||
        (patch.accountFallback !== undefined &&
          patch.accountFallback !== settings.value.accountFallback)
      )
        cancelAllChecks();
      Object.assign(settings.value, patch);
      pausedReason = null;
      await settings.save();
      void runNextCheck();
      return status();
    },
    async start({ jobUrl: rawUrl, description, force = false }) {
      const jobUrl = normalizeJobUrl(rawUrl);
      const parsed = new URL(jobUrl);
      if (!jobUrlContract.isIndeedHost(parsed.hostname) || parsed.protocol !== "https:")
        throw new Error("Blocker checking supports Indeed HTTPS jobs only");
      if (
        typeof description !== "string" ||
        description.trim().length < 40 ||
        description.length > 80_000 ||
        typeof force !== "boolean"
      )
        throw new Error("A full job description between 40 and 80,000 characters is required");
      if (pausedReason || !settings.value.enabled)
        throw new Error(pausedReason || "Blocker checks are off. Enable them in settings.");
      if (!chatgpt.connectionStatus().planUsageEnabled || !settings.value.model)
        throw new Error("Connect ChatGPT plan usage and choose a model in settings");
      const context = { cancellationGeneration, accountId: chatgpt.connectionStatus().activeId };
      const profile = await readProfile({ refreshCvIndex: false });
      if (!isCheckCurrent(context))
        throw new Error("Check interrupted while preparing CV evidence. Try again.");
      const jobId = parsed.searchParams.get("jk");
      const descriptionHash = sha256(description);
      const model = settings.value.model;
      const reasoningEffort = blockerContract.reasoningForModel(model, settings.value.reasoningEffort);
      const inputs = { jobId, descriptionHash, profile, model, reasoningEffort };
      const key = cacheKeyFor(inputs);
      if (checksByCacheKey.has(key)) return checksByCacheKey.get(key).publicState;
      const cached = cache.get(key);
      if (!force && cached) return { status: "completed", cached: true, result: cached };
      const checkJob = {
        key,
        force,
        ...inputs,
        description,
        ...context,
        publicState: { id: randomUUID(), status: "queued" },
      };
      checksById.set(checkJob.publicState.id, checkJob);
      checksByCacheKey.set(key, checkJob);
      // Current selections get ahead of older unstarted checks. Never interrupt a completed-input request just because selection changed.
      queue.unshift(checkJob);
      if (queue.length > 10) {
        cancelQueuedCheck(queue.pop());
      }
      pruneChecks();
      void runNextCheck();
      return checkJob.publicState;
    },
    get(id) {
      const checkJob = checksById.get(id);
      if (!checkJob) throw new Error("Check no longer available. Retry this job.");
      return checkJob.publicState;
    },
    async clearCache() {
      cancelAllChecks();
      await cache.clear();
    },
    async resetForAccountChange() {
      cancelAllChecks();
      settings.value.enabled = false;
      settings.value.model = null;
      settings.value.indexModel = null;
      pausedReason = null;
      await settings.save();
    },
    close() {
      disposed = true;
      cancelAllChecks();
      chatgpt.close();
    },
  };
};
