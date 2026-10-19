(() => {
  globalThis.jobSearchWorkerModules ??= {};
  globalThis.jobSearchWorkerModules.createIndeedListingHandler = ({ isJobSiteSender }) => {
    const messages = globalThis.jobSearchContracts.messages;
    const contract = globalThis.jobSearchContracts.jobAnalyses;
    const keys = globalThis.jobSearchContracts.jobStorageKeys;
    const availabilityContract = globalThis.jobSearchContracts.indeedAvailability;
    const requests = new Map();
    const readListing = async (id) => {
      if (requests.has(id)) return requests.get(id);
      const request = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch(`https://uk.indeed.com/viewjob?jk=${id}`, {
            credentials: "include", cache: "no-store", signal: controller.signal,
          });
          const url = new URL(response.url);
          if (!response.ok || !isJobSiteSender({ url: url.href }, ["indeed"]) ||
              globalThis.jobSearchContracts.jobUrls.identityFromUrl(url)?.id !== id)
            throw new Error("Job listing unavailable");
          return globalThis.jobSearchWorkerModules.parseIndeedListing(await response.text());
        } finally { clearTimeout(timer); }
      })().finally(() => requests.delete(id));
      requests.set(id, request);
      return request;
    };
    const readSavedJob = async (id) => {
      const stored = await chrome.storage.local.get(null);
      if (!contract.isRecord(stored[keys.forJob("analysis", { platform: "indeed", id })]))
        throw new Error("No saved analysis for this job");
      return stored;
    };
    const getTitle = async (id) => {
      const key = keys.forJob("title", { platform: "indeed", id });
      const stored = await readSavedJob(id);
      if (typeof stored[key] === "string" && stored[key].trim()) return { ok: true, title: stored[key] };
      const { title } = await readListing(id);
      if (!title) throw new Error("Job title unavailable");
      await chrome.storage.local.set({ [key]: title });
      return { ok: true, title };
    };
    const getAvailability = async (id) => {
      const key = keys.forJob("indeedAvailability", { platform: "indeed", id });
      const stored = await readSavedJob(id);
      const cached = stored[key];
      if (availabilityContract.isFresh(cached))
        return { ok: true, availability: cached };
      const { availability } = await readListing(id);
      if (!availabilityContract.isStatus(availability)) throw new Error("Job availability could not be confirmed");
      const value = { status: availability, checkedAt: new Date().toISOString() };
      await chrome.storage.local.set({ [key]: value });
      return { ok: true, availability: value };
    };
    const handleMessage = (message, sender, sendResponse) => {
      const titleRequest = message?.type === messages.getIndeedJobTitle;
      if (!titleRequest && message?.type !== messages.getIndeedJobAvailability) return false;
      if (!isJobSiteSender(sender, ["indeed"]) || typeof message.jobId !== "string" ||
          !globalThis.jobSearchContracts.jobUrls.indeedJobKeyPattern.test(message.jobId)) {
        sendResponse({ ok: false, error: titleRequest ? "Job title request is not allowed" : "Job availability request is not allowed" });
        return false;
      }
      (titleRequest ? getTitle : getAvailability)(message.jobId).then(sendResponse, () => sendResponse({
        ok: false, error: titleRequest ? "Job title unavailable" : "Job availability could not be confirmed",
      }));
      return true;
    };
    return handleMessage;
  };
})();
