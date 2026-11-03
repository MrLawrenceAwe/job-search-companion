(() => {
  const companion = globalThis.jobSearchCompanion;
  if (companion.platform !== "indeed") return;
  const eligibility = globalThis.jobSearchContracts.indeedToApply;
  const { indeedJobUrl } = globalThis.jobSearchContracts.jobUrls;
  const keys = globalThis.jobSearchContracts.jobStorageKeys;
  const marks = companion.jobMarkStore;
  const analyses = companion.jobAnalysisStore;
  const metadata = companion.indeedJobMetadata;
  const ready = Promise.all([analyses.ready, marks.ready, metadata.ready]);
  let syncState = "checking";
  const render = companion.indeedToApply.createRenderer();
  const readRecord = (id, kind) =>
    marks.getRecord(keys.forJob(kind, { platform: "indeed", id })) ?? metadata.getRecord(kind, id);
  const selectCandidates = () => {
    const candidates = [];
    for (const [key, record] of analyses.entries()) {
      const { platform, id } = keys.parse(key);
      if (platform !== "indeed") continue;
      const jobUrl = indeedJobUrl("https://uk.indeed.com", id);
      const excluded = eligibility.isExcludedFromRefresh((kind) => readRecord(id, kind));
      if (!eligibility.isEligible({ platform, analysis: record, excluded })) continue;
      candidates.push({ id, jobUrl, record });
    }
    return candidates;
  };
  const refreshMetadata = (candidates) => {
    for (const { id } of candidates) {
      metadata.refresh(id);
    }
  };
  const selectJobs = (candidates) => candidates
    .filter(({ id }) => !eligibility.isExcludedFromDisplay((kind) => readRecord(id, kind)))
    .map(({ id, jobUrl, record }) => ({
      url: jobUrl,
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
