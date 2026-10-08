import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openPrivateStore } from "./private-store.js";
import { digest, readVerifiedProfile } from "./profile.js";
import { CHECKER_VERSION, runBlockerInference } from "./inference.js";
import { validateJobUrl } from "../job-url.js";

const RETENTION_MS = 30 * 86400_000;
export const openBlockerChecker = async ({ directory, profilePaths, chatgpt, infer = runBlockerInference, readProfile = () => readVerifiedProfile(profilePaths) }) => {
  const settings = await openPrivateStore(join(directory, "settings.json"), { enabled: false, model: null, accountFallback: false });
  settings.value.accountFallback ??= false;
  const cache = await openPrivateStore(join(directory, "cache.json"), { results: {} });
  const tasks = new Map(); const byKey = new Map(); let queue = []; let running = null; let epoch = 0; let pausedReason = null; let disposed = false;
  const prune = () => {
    const entries = Object.entries(cache.value.results).filter(([, r]) => Date.now() - Date.parse(r.checkedAt) < RETENTION_MS).sort((a, b) => Date.parse(b[1].checkedAt) - Date.parse(a[1].checkedAt));
    cache.value.results = Object.fromEntries(entries.slice(0, 300));
  };
  prune();
  const pruneTasks = () => {
    for (const [id, task] of tasks) {
      if (tasks.size <= 100) break;
      if (!["checking", "queued"].includes(task.public.status)) tasks.delete(id);
    }
  };
  const release = (item) => { delete item.description; delete item.profile; };
  const status = async () => {
    let profile = null; let profileError = null;
    try { profile = await readProfile(); } catch { profileError = "Verified profile unavailable. Check the local profile files."; }
    return { settings: settings.value, pausedReason, session: chatgpt.session(), profile: profile ? { hash: profile.hash, factCount: profile.facts.length, sources: profile.sources } : null, profileError, queued: queue.length, running: Boolean(running) };
  };
  const pump = async () => {
    if (running || disposed || pausedReason || !settings.value.enabled || !queue.length) return;
    const item = queue.shift(); running = item; item.public.status = "checking";
    item.accountId = chatgpt.session().activeId;
    const controller = new AbortController(); item.controller = controller;
    const timer = setTimeout(() => controller.abort(), 90_000);
    let pendingRecord = null; const previousRecord = cache.value.results[item.key];
    let selectingFallback = false;
    const isCurrent = () => item.epoch === epoch && item.accountId === chatgpt.session().activeId && !disposed && !controller.signal.aborted;
    try {
      let result;
      let candidates = null;
      while (true) {
        try {
          result = await infer({ chatgpt, model: item.model, description: item.description, profile: item.profile, signal: controller.signal });
          break;
        } catch (error) {
          if (!isCurrent() || !settings.value.accountFallback || error.code !== "subscription_sharing_usage_limit_exceeded") throw error;
          selectingFallback = true;
          candidates ??= chatgpt.fallbackAccounts();
          let available = false;
          while (candidates.length && isCurrent()) {
            const id = candidates.shift();
            await chatgpt.select(id);
            item.accountId = id;
            if (!isCurrent()) throw error;
            let models;
            try { models = await chatgpt.models(); }
            catch (catalogError) {
              if (isCurrent() && ([401, 403].includes(catalogError.status) || catalogError.code === "subscription_sharing_usage_limit_exceeded")) continue;
              throw catalogError;
            }
            if (!isCurrent()) throw error;
            if (models.some((m) => m.slug === item.model)) { available = true; break; }
          }
          if (!available) {
            error.message = "ChatGPT usage limit reached. No connected fallback account can continue with this model. Manage usage or connect another account, then resume checks.";
            throw error;
          }
          selectingFallback = false;
        }
      }
      if (item.epoch !== epoch || item.accountId !== chatgpt.session().activeId || disposed || controller.signal.aborted) { item.public.status = "cancelled"; return; }
      const record = { ...result, jobId: item.jobId, descriptionHash: item.descriptionHash, profileHash: item.profile.hash, checkerVersion: CHECKER_VERSION, model: item.model, checkedAt: new Date().toISOString() };
      pendingRecord = record; cache.value.results[item.key] = record; prune(); await cache.save();
      if (item.epoch !== epoch || controller.signal.aborted || disposed) { item.public.status = "cancelled"; return; }
      item.public.status = "completed"; item.public.result = record;
    } catch (error) {
      if (pendingRecord && cache.value.results[item.key] === pendingRecord) {
        if (previousRecord) cache.value.results[item.key] = previousRecord; else delete cache.value.results[item.key];
      }
      item.public.status = !isCurrent() ? "cancelled" : "failed";
      item.public.error = controller.signal.aborted ? "Check interrupted or timed out. Try again." : error.message;
      item.public.code = error.code || "check_failed";
      if (isCurrent() && (selectingFallback || [401, 403, 429].includes(error.status) || error.code === "subscription_sharing_unsupported_capability")) {
        pausedReason = error.message;
        for (const pending of queue) { pending.public.status = "cancelled"; pending.public.error = pausedReason; byKey.delete(pending.key); release(pending); }
        queue = [];
      }
    } finally {
      clearTimeout(timer); byKey.delete(item.key); release(item); running = null;
      pruneTasks();
      void pump();
    }
  };
  const cancelPending = () => {
    epoch += 1;
    for (const item of queue) { item.public.status = "cancelled"; byKey.delete(item.key); release(item); }
    queue = []; running?.controller.abort();
  };
  return {
    status,
    async configure(patch) {
      if (Object.keys(patch).some((key) => !["enabled", "model", "accountFallback"].includes(key)) || ["enabled", "accountFallback"].some((key) => patch[key] !== undefined && typeof patch[key] !== "boolean")) throw new Error("Invalid checker settings");
      if (patch.model !== undefined) {
        const models = await chatgpt.models();
        if (!models.some((m) => m.slug === patch.model)) throw new Error("Choose a model available to the connected ChatGPT account");
      }
      if (patch.enabled && (!chatgpt.session().sharing || !(patch.model || settings.value.model))) throw new Error("Connect ChatGPT plan usage and choose a model first");
      if (patch.enabled && !(await readProfile()).facts.length) throw new Error("Verified profile unavailable");
      if (patch.enabled === false || (patch.model && patch.model !== settings.value.model) || (patch.accountFallback !== undefined && patch.accountFallback !== settings.value.accountFallback)) cancelPending();
      Object.assign(settings.value, patch); pausedReason = null; await settings.save(); void pump(); return status();
    },
    async start({ jobUrl: rawUrl, description, force = false }) {
      const jobUrl = validateJobUrl(rawUrl); const parsed = new URL(jobUrl);
      if (!parsed.hostname.match(/(^|\.)indeed\.(com|co\.uk)$/) || parsed.protocol !== "https:") throw new Error("Background checking supports Indeed HTTPS jobs only");
      if (typeof description !== "string" || description.trim().length < 40 || description.length > 80_000 || typeof force !== "boolean") throw new Error("A full job description between 40 and 80,000 characters is required");
      const profile = await readProfile(); const jobId = parsed.searchParams.get("jk"); const descriptionHash = digest(description); const model = settings.value.model;
      const key = digest({ jobId, descriptionHash, profileHash: profile.hash, checkerVersion: CHECKER_VERSION, model });
      prune();
      if (byKey.has(key)) return byKey.get(key).public;
      if (!force && cache.value.results[key]) return { status: "completed", cached: true, result: cache.value.results[key] };
      if (pausedReason || !settings.value.enabled) throw new Error(pausedReason || "Background checks are paused. Enable them in settings.");
      if (!chatgpt.session().sharing || !model) throw new Error("Connect ChatGPT plan usage and choose a model in settings");
      const item = { key, jobId, model, description, descriptionHash, profile, epoch, accountId: chatgpt.session().activeId, public: { id: randomUUID(), status: "queued" } };
      tasks.set(item.public.id, item); byKey.set(key, item);
      // Current selections get ahead of older unstarted checks. Never interrupt a completed-input request just because selection changed.
      queue.unshift(item);
      if (queue.length > 10) { const dropped = queue.pop(); dropped.public.status = "cancelled"; byKey.delete(dropped.key); release(dropped); }
      pruneTasks();
      void pump(); return item.public;
    },
    get(id) { const item = tasks.get(id); if (!item) throw new Error("Check no longer available. Retry this job."); return item.public; },
    async clearCache() { cancelPending(); cache.value.results = {}; await cache.save(); },
    async accountChanged() { cancelPending(); settings.value.enabled = false; settings.value.model = null; pausedReason = null; await settings.save(); },
    close() { disposed = true; cancelPending(); chatgpt.close(); },
  };
};
