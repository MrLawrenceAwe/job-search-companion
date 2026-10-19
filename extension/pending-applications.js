(() => {
  const companion = globalThis.jobSearchCompanion;
  if (companion.platform !== "indeed") return;
  const contract = globalThis.jobSearchContracts.jobAnalyses;
  const keys = globalThis.jobSearchContracts.jobStorageKeys;
  const indeedKey = (kind, id) => keys.forJob(kind, { platform: "indeed", id });
  const records = new Map();
  const titles = new Map();
  const applied = new Set();
  const unsuitable = new Set();
  const dismissed = new Set();
  const indeedApplied = new Set();
  const titleRequests = new Map();
  const availability = new Map();
  const availabilityRequests = new Map();
  let syncState = "checking";
  let panel;
  let signature;
  let currentPage = { cards: new Map(), jobUrl: null };
  const read = (key, value) => {
    const identity = keys.parse(key);
    if (identity?.platform !== "indeed") return;
    const { kind, id } = identity;
    const analysisKey = indeedKey("analysis", id);
    if (kind === "analysis") {
      if (contract.isRecord(value)) records.set(analysisKey, value);
      else records.delete(analysisKey);
    } else if (["applied", "unsuitable", "indeedDismissed", "indeedApplied"].includes(kind)) {
      const [entries, timestamp] = {
        applied: [applied, "appliedAt"], unsuitable: [unsuitable, "unsuitableAt"],
        indeedDismissed: [dismissed, "dismissedAt"], indeedApplied: [indeedApplied, "detectedAt"],
      }[kind];
      if (typeof value?.[timestamp] === "string") entries.add(analysisKey);
      else entries.delete(analysisKey);
    } else if (kind === "indeedAvailability") {
      if (["active", "expired"].includes(value?.status) && Number.isFinite(Date.parse(value.checkedAt))) availability.set(id, value);
      else availability.delete(id);
    } else if (kind === "title") {
      if (typeof value === "string") titles.set(key, value);
      else titles.delete(key);
    }
  };
  const ready = chrome.storage.local.get(null).then((stored) => {
    for (const [key, value] of Object.entries(stored)) read(key, value);
  });
  const rememberTitle = (jobUrl, title, updates) => {
    const key = keys.forUrl("title", jobUrl);
    const clean = title?.replace(/\s+/g, " ").replace(/\s*-\s*job post\s*$/i, "").trim();
    if (!clean || titles.get(key) === clean) return;
    titles.set(key, clean);
    updates[key] = clean;
  };
  const titleFor = (id) => {
    const key = indeedKey("title", id);
    if (titles.has(key)) return titles.get(key);
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
    return titles.get(key) || (request.pending ? "Loading job title…" : "Job title unavailable — open listing");
  };
  const checkAvailability = (id) => {
    if (Date.now() - Date.parse(availability.get(id)?.checkedAt) < 3_600_000) return;
    const request = availabilityRequests.get(id);
    if (request && (request.pending || Date.now() - request.attemptedAt < 3_600_000)) return;
    const next = { pending: true, attemptedAt: Date.now() };
    availabilityRequests.set(id, next);
    chrome.runtime.sendMessage({ type: globalThis.jobSearchContracts.messages.getIndeedJobAvailability, jobId: id }, (response) => {
      next.pending = false;
      if (!chrome.runtime.lastError && response?.ok && ["active", "expired"].includes(response.availability?.status)) {
        availability.set(id, response.availability);
      }
      companion.pageDecorations.schedule();
    });
  };
  const render = ({ cards, heading, jobUrl }) => {
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
      void chrome.storage.local.set(updates).catch((error) => console.debug("Job titles could not be saved:", error));
    }
    const jobs = [];
    for (const [key, record] of records) {
      if (applied.has(key) || indeedApplied.has(key) || unsuitable.has(key) || dismissed.has(key)
        || !["use as-is", "edit the CV"].includes(record.verdict)) continue;
      // Derive links from the validated identity, never from stored arbitrary URLs.
      const id = keys.parse(key).id;
      checkAvailability(id);
      if (availability.get(id)?.status === "expired") continue;
      jobs.push({
        url: `https://uk.indeed.com/viewjob?jk=${id}`,
        title: titleFor(id),
        verdict: record.verdict,
        date: record.analyzedAt,
      });
    }
    jobs.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.url.localeCompare(b.url));
    if (!panel?.isConnected) {
      panel = document.createElement("details");
      panel.className = "jsc-pending-applications";
      panel.append(document.createElement("summary"), document.createElement("div"));
      document.body.append(panel);
      signature = null;
    }
    const next = JSON.stringify({ jobs, syncState });
    if (signature === next) return;
    signature = next;
    panel.querySelector("summary").textContent = `To apply · ${jobs.length}`;
    const content = panel.querySelector("div");
    const note = document.createElement("p");
    const list = document.createElement("ul");
    for (const job of jobs) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = job.url;
      link.textContent = job.title;
      const verdict = document.createElement("span");
      verdict.textContent = job.verdict === "use as-is" ? "Use as is" : "Edit CV";
      item.append(link, verdict);
      list.append(item);
    }
    if (!jobs.length) note.textContent = "No analysed jobs waiting for you to apply.";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = syncState === "checking" ? "Checking Indeed applications…"
      : syncState === "failed" ? "Couldn’t refresh Indeed applications. Showing saved status." : "";
    status.hidden = !status.textContent;
    content.replaceChildren(...(jobs.length ? [] : [note]), status, list);
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
      if (!records.has(analysisKey)) return;
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
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    void ready.then(() => {
      for (const [key, { newValue }] of Object.entries(changes)) read(key, newValue);
      companion.pageDecorations.schedule();
    });
  });
  companion.pageDecorations.register(render, ready);
  const sync = () => {
    if (document.visibilityState === "hidden") return;
    chrome.runtime.sendMessage({ type: globalThis.jobSearchContracts.messages.syncIndeedApplications }, (response) => {
      syncState = chrome.runtime.lastError || !response?.ok ? "failed" : "ready";
      companion.pageDecorations.schedule();
    });
  };
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pageshow", sync);
  window.setInterval(sync, 60_000);
  void ready.then(sync);
})();
