(() => {
  const companion = globalThis.jobSearchCompanion;
  if (companion.platform !== "indeed") return;
  const { jobStorageKeys: keys, jobUrls } = globalThis.jobSearchContracts;
  const availabilityContract = globalThis.jobSearchContracts.indeedAvailability;
  const AVAILABILITY_RETRY_INTERVAL_MS = 3_600_000;
  const indeedKey = (kind, id) => keys.forJob(kind, { platform: "indeed", id });
  const indeedIdFromUrl = (jobUrl) => {
    const url = new URL(jobUrl);
    const identity = jobUrls.identityFromUrl(url);
    if (url.protocol !== "https:" || identity?.platform !== "indeed") throw new Error("Couldn’t identify this job.");
    return identity.id;
  };
  const analyses = companion.jobAnalysisStore;
  const titles = new Map();
  const applicationRecords = new Map();
  const titleRequests = new Map();
  const availability = new Map();
  const availabilityRequests = new Map();
  let currentPage = { cards: new Map(), jobUrl: null };
  const applyRecord = (key, value) => {
    const identity = keys.parse(key);
    if (identity?.platform !== "indeed") return;
    const { kind, id } = identity;
    if (["indeedDismissed", "indeedApplied"].includes(kind)) {
      if (value === undefined) applicationRecords.delete(key);
      else applicationRecords.set(key, value);
    } else if (kind === "indeedAvailability") {
      if (availabilityContract.isRecord(value)) availability.set(id, value);
      else availability.delete(id);
    } else if (kind === "title") {
      if (typeof value === "string") titles.set(id, value);
      else titles.delete(id);
    } else return false;
    return true;
  };
  const metadata = globalThis.jobSearchStorage.observe({
    applyRecord, errorMessage: "Job metadata update failed:",
  });
  const ready = Promise.all([analyses.ready, metadata.ready]);
  const rememberTitle = (jobUrl, title, updates) => {
    const id = indeedIdFromUrl(jobUrl);
    const clean = companion.text.normalizeJobTitle(title);
    if (!clean || titles.get(id) === clean) return;
    titles.set(id, clean);
    updates[indeedKey("title", id)] = clean;
  };
  const refreshJobTitle = (id) => {
    if (titles.has(id)) return;
    let request = titleRequests.get(id);
    if (!request || (!request.pending && Date.now() - request.attemptedAt >= 60_000)) {
      request = { pending: true, attemptedAt: Date.now() };
      titleRequests.set(id, request);
      chrome.runtime.sendMessage({ type: globalThis.jobSearchContracts.messages.getIndeedJobTitle, jobId: id }, (response) => {
        request.pending = false;
        if (!chrome.runtime.lastError && response?.ok && typeof response.title === "string" && response.title.trim()) {
          titles.set(id, response.title.trim());
        }
        companion.pageDecorations.schedule();
      });
    }
  };
  const titleFor = (id) => {
    if (titles.has(id)) return titles.get(id);
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
      const id = indeedIdFromUrl(jobUrl);
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
      if (!analyses.get(jobUrl)) return;
      const id = indeedIdFromUrl(jobUrl);
      const key = indeedKey("indeedDismissed", id);
      if (undo) {
        await chrome.storage.local.remove(key);
        applicationRecords.delete(key);
      } else {
        const record = { dismissedAt: new Date().toISOString() };
        await chrome.storage.local.set({ [key]: record });
        applicationRecords.set(key, record);
      }
      companion.pageDecorations.schedule();
    }).catch((error) => console.debug("Indeed dismissal could not be saved:", error));
  }, true);
  companion.indeedJobMetadata = Object.freeze({
    ready,
    subscribe: metadata.subscribe,
    rememberPage: rememberPageMetadata,
    titleFor,
    getRecord: (kind, id) => kind === "indeedAvailability"
      ? availability.get(id) : applicationRecords.get(indeedKey(kind, id)),
    refresh(id) {
      checkAvailability(id);
      if (availability.get(id)?.status !== "expired") refreshJobTitle(id);
    },
  });
})();
