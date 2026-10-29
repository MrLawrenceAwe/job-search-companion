(() => {
  const companion = globalThis.jobSearchCompanion;
  if (companion.platform !== "indeed") return;
  const eligibility = globalThis.jobSearchContracts.indeedToApply;
  const keys = globalThis.jobSearchContracts.jobStorageKeys;
  const marks = companion.jobMarkStore;
  const analyses = companion.jobAnalysisStore;
  const metadata = companion.indeedJobMetadata;
  const ready = Promise.all([analyses.ready, marks.ready, metadata.ready]);
  let syncState = "checking";
  const render = companion.indeedToApply.createRenderer();
  const selectCandidates = () => {
    const candidates = [];
    for (const [key, record] of analyses.entries()) {
      const { platform, id } = keys.parse(key);
      if (platform !== "indeed") continue;
      const jobUrl = `https://uk.indeed.com/viewjob?jk=${id}`;
      if (!eligibility.isEligible({ platform, analysis: record,
        excluded: marks.isMarked(jobUrl, "applied") || marks.isMarked(jobUrl, "unsuitable")
          || metadata.isExcluded(jobUrl),
      })) continue;
      candidates.push({ id, record });
    }
    return candidates;
  };
  const refreshMetadata = (candidates) => {
    for (const { id } of candidates) {
      metadata.refresh(id);
    }
  };
  const selectJobs = (candidates) => candidates
    .filter(({ id }) => !metadata.isExpired(id))
    .map(({ id, record }) => ({
      // Derive links from the validated identity, never from stored arbitrary URLs.
      url: `https://uk.indeed.com/viewjob?jk=${id}`,
      title: metadata.titleFor(id),
      verdict: record.verdict,
      date: record.analyzedAt,
    }))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.url.localeCompare(b.url));
  metadata.subscribe(companion.pageDecorations.schedule);
  analyses.subscribe(companion.pageDecorations.schedule);
  marks.subscribe(companion.pageDecorations.schedule);
  const updatePage = (page) => {
    metadata.rememberPage(page);
    const candidates = selectCandidates();
    refreshMetadata(candidates);
    render({ jobs: selectJobs(candidates), syncState });
  };
  companion.pageDecorations.register(updatePage, ready);
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
