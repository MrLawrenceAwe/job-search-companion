import { sha256, hashJson } from "../../shared/sha256.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openPrivateStore } from "./private-store.js";
import { readVerifiedProfile } from "./profile.js";
import { runBlockerInference } from "./inference.js";
import { jobUrlContract } from "../../shared/contracts.js";
import { normalizeJobUrl } from "../job-url.js";

import { blockerContract } from "../../shared/contracts.js";
const { version: CHECKER_VERSION } = blockerContract;
import { openResultCache } from "./result-cache.js";
import { inferWithAccountFallback } from "./account-fallback.js";
export const openBlockerChecker = async ({
  directory,
  profilePaths,
  chatgpt,
  infer = runBlockerInference,
  readProfile = () => readVerifiedProfile(profilePaths),
}) => {
  const settings = await openPrivateStore(join(directory, "settings.json"), {
    enabled: false,
    model: null,
    accountFallback: false,
  });
  settings.value.accountFallback ??= false;
  const cache = await openResultCache(directory);
  const tasks = new Map();
  const tasksByCacheKey = new Map();
  let queue = [];
  let running = null;
  let cancellationGeneration = 0;
  let pausedReason = null;
  let disposed = false;
  const pruneTasks = () => {
    for (const [id, task] of tasks) {
      if (tasks.size <= 100) break;
      if (!["checking", "queued"].includes(task.public.status)) tasks.delete(id);
    }
  };
  const release = (item) => {
    delete item.description;
    delete item.profile;
  };
  const status = async () => {
    let profile = null;
    let profileError = null;
    try {
      profile = await readProfile();
    } catch {
      profileError = "Verified profile unavailable. Check the local profile files.";
    }
    return {
      settings: settings.value,
      pausedReason,
      session: chatgpt.session(),
      profile: profile
        ? {
            hash: profile.hash,
            factCount: profile.facts.length,
            sources: profile.sources,
          }
        : null,
      profileError,
      queued: queue.length,
      running: Boolean(running),
    };
  };
  const runNextCheck = async () => {
    if (running || disposed || pausedReason || !settings.value.enabled || !queue.length) return;
    const item = queue.shift();
    running = item;
    item.public.status = "checking";
    item.accountId = chatgpt.session().activeId;
    const controller = new AbortController();
    item.controller = controller;
    const timer = setTimeout(() => controller.abort(), 90_000);
    let pendingRecord = null;
    const previousRecord = cache.get(item.key);
    const isCurrent = () =>
      item.cancellationGeneration === cancellationGeneration &&
      item.accountId === chatgpt.session().activeId &&
      !disposed &&
      !controller.signal.aborted;
    try {
      const result = await inferWithAccountFallback({
        chatgpt,
        infer,
        item,
        signal: controller.signal,
        isCurrent,
        enabled: () => settings.value.accountFallback,
      });
      if (
        item.cancellationGeneration !== cancellationGeneration ||
        item.accountId !== chatgpt.session().activeId ||
        disposed ||
        controller.signal.aborted
      ) {
        item.public.status = "cancelled";
        return;
      }
      const record = {
        ...result,
        jobId: item.jobId,
        descriptionHash: item.descriptionHash,
        profileHash: item.profile.hash,
        checkerVersion: CHECKER_VERSION,
        model: item.model,
        checkedAt: new Date().toISOString(),
      };
      pendingRecord = record;
      await cache.put(item.key, record);
      if (
        item.cancellationGeneration !== cancellationGeneration ||
        controller.signal.aborted ||
        disposed
      ) {
        item.public.status = "cancelled";
        return;
      }
      item.public.status = "completed";
      item.public.result = record;
    } catch (error) {
      if (pendingRecord) cache.restore(item.key, pendingRecord, previousRecord);
      item.public.status = !isCurrent() ? "cancelled" : "failed";
      item.public.error = controller.signal.aborted
        ? "Check interrupted or timed out. Try again."
        : error.message;
      item.public.code = error.code || "check_failed";
      if (
        isCurrent() &&
        (error.pauseChecks ||
          [401, 403, 429].includes(error.status) ||
          error.code === "subscription_sharing_unsupported_capability")
      ) {
        pausedReason = error.message;
        for (const pending of queue) {
          pending.public.status = "cancelled";
          pending.public.error = pausedReason;
          tasksByCacheKey.delete(pending.key);
          release(pending);
        }
        queue = [];
      }
    } finally {
      clearTimeout(timer);
      tasksByCacheKey.delete(item.key);
      release(item);
      running = null;
      pruneTasks();
      void runNextCheck();
    }
  };
  const cancelPending = () => {
    cancellationGeneration += 1;
    for (const item of queue) {
      item.public.status = "cancelled";
      tasksByCacheKey.delete(item.key);
      release(item);
    }
    queue = [];
    running?.controller.abort();
  };
  return {
    status,
    async configure(patch) {
      if (
        Object.keys(patch).some((key) => !["enabled", "model", "accountFallback"].includes(key)) ||
        ["enabled", "accountFallback"].some(
          (key) => patch[key] !== undefined && typeof patch[key] !== "boolean",
        )
      )
        throw new Error("Invalid checker settings");
      if (patch.model !== undefined) {
        const models = await chatgpt.models();
        if (!models.some((m) => m.slug === patch.model))
          throw new Error("Choose a model available to the connected ChatGPT account");
      }
      if (patch.enabled && (!chatgpt.session().sharing || !(patch.model || settings.value.model)))
        throw new Error("Connect ChatGPT plan usage and choose a model first");
      if (patch.enabled && !(await readProfile()).facts.length)
        throw new Error("Verified profile unavailable");
      if (
        patch.enabled === false ||
        (patch.model && patch.model !== settings.value.model) ||
        (patch.accountFallback !== undefined &&
          patch.accountFallback !== settings.value.accountFallback)
      )
        cancelPending();
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
        throw new Error("Background checking supports Indeed HTTPS jobs only");
      if (
        typeof description !== "string" ||
        description.trim().length < 40 ||
        description.length > 80_000 ||
        typeof force !== "boolean"
      )
        throw new Error("A full job description between 40 and 80,000 characters is required");
      const profile = await readProfile();
      const jobId = parsed.searchParams.get("jk");
      const descriptionHash = sha256(description);
      const model = settings.value.model;
      const key = hashJson({
        jobId,
        descriptionHash,
        profileHash: profile.hash,
        checkerVersion: CHECKER_VERSION,
        model,
      });
      if (tasksByCacheKey.has(key)) return tasksByCacheKey.get(key).public;
      const cached = cache.get(key);
      if (!force && cached) return { status: "completed", cached: true, result: cached };
      if (pausedReason || !settings.value.enabled)
        throw new Error(pausedReason || "Background checks are paused. Enable them in settings.");
      if (!chatgpt.session().sharing || !model)
        throw new Error("Connect ChatGPT plan usage and choose a model in settings");
      const item = {
        key,
        jobId,
        model,
        description,
        descriptionHash,
        profile,
        cancellationGeneration,
        accountId: chatgpt.session().activeId,
        public: { id: randomUUID(), status: "queued" },
      };
      tasks.set(item.public.id, item);
      tasksByCacheKey.set(key, item);
      // Current selections get ahead of older unstarted checks. Never interrupt a completed-input request just because selection changed.
      queue.unshift(item);
      if (queue.length > 10) {
        const dropped = queue.pop();
        dropped.public.status = "cancelled";
        tasksByCacheKey.delete(dropped.key);
        release(dropped);
      }
      pruneTasks();
      void runNextCheck();
      return item.public;
    },
    get(id) {
      const item = tasks.get(id);
      if (!item) throw new Error("Check no longer available. Retry this job.");
      return item.public;
    },
    async clearCache() {
      cancelPending();
      await cache.clear();
    },
    async accountChanged() {
      cancelPending();
      settings.value.enabled = false;
      settings.value.model = null;
      pausedReason = null;
      await settings.save();
    },
    close() {
      disposed = true;
      cancelPending();
      chatgpt.close();
    },
  };
};
