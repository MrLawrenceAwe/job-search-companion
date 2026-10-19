(() => {
  const companion = globalThis.jobSearchCompanion;
  if (companion.platform !== "indeed") return;
  const contract = globalThis.jobSearchContracts.jobAnalyses;
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
    if (key.startsWith("analyzed-job:indeed:")) {
      if (contract.isRecord(value)) records.set(key, value);
      else records.delete(key);
    } else if (key.startsWith("applied-job:indeed:")) {
      const analysisKey = key.replace("applied-job:", "analyzed-job:");
      if (typeof value?.appliedAt === "string") applied.add(analysisKey);
      else applied.delete(analysisKey);
    } else if (key.startsWith("unsuitable-job:indeed:")) {
      const analysisKey = key.replace("unsuitable-job:", "analyzed-job:");
      if (typeof value?.unsuitableAt === "string") unsuitable.add(analysisKey);
      else unsuitable.delete(analysisKey);
    } else if (key.startsWith("indeed-dismissed-job:")) {
      const analysisKey = `analyzed-job:indeed:${key.slice("indeed-dismissed-job:".length)}`;
      if (typeof value?.dismissedAt === "string") dismissed.add(analysisKey);
      else dismissed.delete(analysisKey);
    } else if (key.startsWith("indeed-applied-job:")) {
      const analysisKey = `analyzed-job:indeed:${key.slice("indeed-applied-job:".length)}`;
      if (typeof value?.detectedAt === "string") indeedApplied.add(analysisKey);
      else indeedApplied.delete(analysisKey);
    } else if (key.startsWith("indeed-job-availability:")) {
      const id = key.slice("indeed-job-availability:".length);
      if (["active", "expired"].includes(value?.status) && Number.isFinite(Date.parse(value.checkedAt))) availability.set(id, value);
      else availability.delete(id);
    } else if (key.startsWith("job-title:indeed:")) {
      if (typeof value === "string") titles.set(key, value);
      else titles.delete(key);
    }
  };
  const ready = chrome.storage.local.get(null).then((stored) => {
    for (const [key, value] of Object.entries(stored)) read(key, value);
  });
  const rememberTitle = (jobUrl, title, updates) => {
    const key = contract.keyFor(jobUrl).replace("analyzed-job:", "job-title:");
    const clean = title?.replace(/\s+/g, " ").replace(/\s*-\s*job post\s*$/i, "").trim();
    if (!clean || titles.get(key) === clean) return;
    titles.set(key, clean);
    updates[key] = clean;
  };
  const titleFor = (id) => {
    const key = `job-title:indeed:${id}`;
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
      const id = contract.keyFor(jobUrl).slice("analyzed-job:indeed:".length);
      if (availability.get(id)?.status !== "expired") {
        const value = { status: "expired", checkedAt: new Date().toISOString() };
        availability.set(id, value);
        updates[`indeed-job-availability:${id}`] = value;
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
      const id = key.slice("analyzed-job:indeed:".length);
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) continue;
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
      const key = analysisKey.replace("analyzed-job:indeed:", "indeed-dismissed-job:");
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
