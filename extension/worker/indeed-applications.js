(() => {
  globalThis.jobSearchWorkerModules ??= {};
  globalThis.jobSearchWorkerModules.createIndeedApplicationHandler = ({ isJobSiteSender }) => {
    const keys = globalThis.jobSearchContracts.jobStorageKeys;
    const indeedKey = (kind, id) => keys.forJob(kind, { platform: "indeed", id });
    const messages = globalThis.jobSearchContracts.messages;
    const REQUEST_TIMEOUT_MS = 10_000;
    let indeedApplicationsSync = null;
    let lastIndeedApplicationsSync = 0;
    const syncIndeedApplications = () => {
      if (indeedApplicationsSync) return indeedApplicationsSync;
      if (Date.now() - lastIndeedApplicationsSync < 30_000) return Promise.resolve({ ok: true });
      indeedApplicationsSync = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          // Read the same history as My jobs, including archived applications. Never
          // request application forms or treat an apply start as a submitted job.
          const groups = await Promise.all(["POST_APPLY", "ARCHIVED"].map(async (type) => {
            const response = await fetch(
              `https://myjobs.indeed.com/api/v1/appStatusJobs?type=${type}&applyUpdateStartTime=0`,
              { credentials: "include", cache: "no-store", signal: controller.signal },
            );
            if (!response.ok) throw new Error("Indeed application history unavailable");
            const body = await response.json();
            if (body.success !== true || !Array.isArray(body.body?.appStatusJobs)) {
              throw new Error("Indeed application history unavailable");
            }
            return body.body.appStatusJobs;
          }));
          const stored = await chrome.storage.local.get(null);
          const values = {};
          const completed = new Set(["APPLIED", "VIEWED", "REVIEWED", "PHONE_SCREENED", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]);
          const detectedAt = new Date().toISOString();
          for (const job of groups.flat()) {
            const id = job?.jobKey;
            if (!globalThis.jobSearchContracts.jobUrls.indeedJobKeyPattern.test(id || "")) continue;
            // Retain only the jobs that have a saved analysis, not the full account history.
            if (!stored[indeedKey("analysis", id)]) continue;
            if (typeof job.jobTitle === "string" && job.jobTitle.trim()) {
              const key = indeedKey("title", id);
              const title = job.jobTitle.trim();
              if (stored[key] !== title) values[key] = title;
            }
            const statuses = job.statuses;
            if (![statuses?.candidateStatus?.status, statuses?.selfReportedStatus?.status].some((status) => completed.has(status))) continue;
            const key = indeedKey("indeedApplied", id);
            if (!stored[key]) values[key] = { detectedAt };
          }
          if (Object.keys(values).length) await chrome.storage.local.set(values);
          lastIndeedApplicationsSync = Date.now();
          return { ok: true };
        } finally {
          clearTimeout(timer);
        }
      })().finally(() => { indeedApplicationsSync = null; });
      return indeedApplicationsSync;
    };
    const handleIndeedApplicationsMessage = (message, sender, sendResponse) => {
      if (message?.type !== messages.syncIndeedApplications) return false;
      if (!isJobSiteSender(sender, ["indeed"])) {
        sendResponse({ ok: false, error: "Indeed application request is not allowed" });
        return false;
      }
      syncIndeedApplications().then(sendResponse, () => sendResponse({ ok: false, error: "Couldn’t refresh Indeed applications" }));
      return true;
    };

    return handleIndeedApplicationsMessage;
  };
})();
