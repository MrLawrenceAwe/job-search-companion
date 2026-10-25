(() => {
  const companion = globalThis.jobSearchCompanion;
  if (companion.platform !== "indeed") return;
  const contract = globalThis.jobSearchContracts.jobAnalyses;
  const keys = globalThis.jobSearchContracts.jobStorageKeys;
  const availabilityContract = globalThis.jobSearchContracts.indeedAvailability;
  const AVAILABILITY_RETRY_INTERVAL_MS = 3_600_000;
  const indeedKey = (kind, id) => keys.forJob(kind, { platform: "indeed", id });
  const analyses = companion.jobAnalysisStore;
  const titles = new Map();
  const dismissed = new Set();
  const indeedApplied = new Set();
  const titleRequests = new Map();
  const availability = new Map();
  const availabilityRequests = new Map();
  let currentPage = { cards: new Map(), jobUrl: null };
  const applyRecord = (key, value) => {
    const identity = keys.parse(key);
    if (identity?.platform !== "indeed") return;
    const { kind, id } = identity;
    const analysisKey = indeedKey("analysis", id);
    if (["indeedDismissed", "indeedApplied"].includes(kind)) {
      const [entries, timestamp] = {
        indeedDismissed: [dismissed, "dismissedAt"], indeedApplied: [indeedApplied, "detectedAt"],
      }[kind];
      if (typeof value?.[timestamp] === "string") entries.add(analysisKey);
      else entries.delete(analysisKey);
    } else if (kind === "indeedAvailability") {
      if (availabilityContract.isRecord(value)) availability.set(id, value);
      else availability.delete(id);
    } else if (kind === "title") {
      if (typeof value === "string") titles.set(key, value);
      else titles.delete(key);
    } else return false;
    return true;
  };
  const metadata = globalThis.jobSearchStorage.observe({
    applyRecord, errorMessage: "Job metadata update failed:",
  });
  const ready = Promise.all([analyses.ready, metadata.ready]);
  const rememberTitle = (jobUrl, title, updates) => {
    const key = keys.forUrl("title", jobUrl);
    const clean = companion.text.normalizeJobTitle(title);
    if (!clean || titles.get(key) === clean) return;
    titles.set(key, clean);
    updates[key] = clean;
  };
  const refreshJobTitle = (id) => {
    const key = indeedKey("title", id);
    if (titles.has(key)) return;
    let request = titleRequests.get(id);
    if (!request || (!request.pending && Date.now() - request.attemptedAt >= 60_000)) {
      request = { pending: true, attemptedAt: Date.now() };
      titleRequests.set(id, request);
      chrome.runtime.sendMessage({ type: globalThis.jobSearchContracts.messages.getIndeedJobTitle, jobId: id }, (response) => {
        request.pending = false;
        if (!chrome.runtime.lastError && response?.ok && typeof response.title === "string" && response.title.trim()) {
          titles.set(key, response.title.trim());
        }
        companion.pageDecorations.schedule();
      });
    }
  };
  const titleFor = (id) => {
    const key = indeedKey("title", id);
    if (titles.has(key)) return titles.get(key);
    return titleRequests.get(id)?.pending ? "Loading job title…" : "Job title unavailable — open listing";
  };
  const checkAvailability = (id) => {
    if (availabilityContract.isFresh(availability.get(id))) return;
    const request = availabilityRequests.get(id);
    if (request && (request.pending || Date.now() - request.attemptedAt < AVAILABILITY_RETRY_INTERVAL_MS)) return;
    const next = { pending: true, attemptedAt: Date.now() };
    availabilityRequests.set(id, next);
    chrome.runtime.sendMessage({ type: globalThis.jobSearchContracts.messages.getIndeedJobAvailability, jobId: id }, (response) => {
      next.pending = false;
      if (!chrome.runtime.lastError && response?.ok && availabilityContract.isRecord(response.availability)) {
        availability.set(id, response.availability);
      }
      companion.pageDecorations.schedule();
    });
  };
  const rememberPageMetadata = ({ cards, heading, jobUrl }) => {
    currentPage = { cards, jobUrl };
    const updates = {};
    for (const [card, url] of cards) {
      rememberTitle(url, card.querySelector('h2, h3, [data-testid="jobTitle"]')?.textContent, updates);
    }
    if (jobUrl && heading) rememberTitle(jobUrl, heading.textContent, updates);
    // Indeed keeps the job description visible after expiry. Its explicit
    // notice, rather than the presence of a title/description, decides this.
    if (jobUrl && heading && [...document.querySelectorAll('#alert-content h3')].some(
      (element) => element.textContent.trim() === "This job has expired on Indeed",
    )) {
      const id = keys.parse(contract.keyFor(jobUrl)).id;
      if (availability.get(id)?.status !== "expired") {
        const value = { status: "expired", checkedAt: new Date().toISOString() };
        availability.set(id, value);
        updates[indeedKey("indeedAvailability", id)] = value;
      }
    }
    if (Object.keys(updates).length) {
      void chrome.storage.local.set(updates).catch((error) => console.debug("Job metadata could not be saved:", error));
    }
  };
  // Remember the user's native Indeed dismissal separately from their manual
  // Unsuitable mark, so undoing one never clears the other.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.('button, [role="button"]');
    if (!button || !(/^(?:not interested)(?:,|$)/i.test(button.getAttribute("aria-label") || button.textContent.trim())
      || button.matches('[data-testid="vj-dislikeJobButton"]'))) return;
    let jobUrl = [...currentPage.cards].find(([card]) => card.contains(button))?.[1];
    if (!jobUrl && button.matches('[data-testid="vj-dislikeJobButton"]')) jobUrl = currentPage.jobUrl;
    if (!jobUrl) return;
    const undo = button.getAttribute("aria-pressed") === "true";
    void ready.then(async () => {
      const analysisKey = contract.keyFor(jobUrl);
      if (!analyses.get(jobUrl)) return;
      const key = keys.forUrl("indeedDismissed", jobUrl);
      if (undo) {
        await chrome.storage.local.remove(key);
        dismissed.delete(analysisKey);
      } else {
        await chrome.storage.local.set({ [key]: { dismissedAt: new Date().toISOString() } });
        dismissed.add(analysisKey);
      }
      companion.pageDecorations.schedule();
    }).catch((error) => console.debug("Indeed dismissal could not be saved:", error));
  }, true);
  companion.indeedJobMetadata = Object.freeze({
    ready,
    subscribe: metadata.subscribe,
    rememberPage: rememberPageMetadata,
    titleFor,
    isExpired: (id) => availability.get(id)?.status === "expired",
    isExcluded: (jobUrl) => {
      const key = contract.keyFor(jobUrl);
      return indeedApplied.has(key) || dismissed.has(key);
    },
    refresh(id) {
      checkAvailability(id);
      if (availability.get(id)?.status !== "expired") refreshJobTitle(id);
    },
  });
})();
