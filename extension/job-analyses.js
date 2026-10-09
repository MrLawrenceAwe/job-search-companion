(() => {
  const companion = globalThis.jobSearchCompanion;
  const contract = globalThis.jobSearchContracts.jobAnalyses;
  const records = new Map();
  let timer = null;
  const read = (key, record) => {
    if (!key.startsWith("analyzed-job:")) return;
    if (contract.isRecord(record)) records.set(key, record);
    else records.delete(key);
  };
  const ready = chrome.storage.local.get(null).then((stored) => {
    for (const [key, record] of Object.entries(stored)) read(key, record);
  });
  const recordFor = (url) => records.get(contract.keyFor(url));
  const updateLink = (link, jobUrl, record) => {
    link.dataset.threadId = record.threadId;
    link.dataset.jobUrl = jobUrl;
    link.dataset.verdictColor = contract.colorFor(record.verdict);
    link.title = `${record.verdict || "Verdict not recorded"} — Open completed CV-fit analysis in Codex (${new Date(record.analyzedAt).toLocaleDateString()})`;
  };
  const createLink = (jobUrl, record) => {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "jsc-analysis-link";
    link.textContent = "Analysed · Open analysis";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      link.disabled = true;
      chrome.runtime.sendMessage({
        type: globalThis.jobSearchContracts.messages.openJobAnalysis, jobUrl: link.dataset.jobUrl,
      }, (response) => {
        link.disabled = false;
        if (chrome.runtime.lastError || !response?.ok) {
          companion.showToast(response?.error || "Couldn’t open the analysis. Check that the local bridge is running.", "error");
        }
      });
    });
    updateLink(link, jobUrl, record);
    return link;
  };
  const render = () => {
    if (!document.body) return;
    const targets = new Map();
    for (const { element, jobUrl } of companion.jobs.collectJobCarriers(companion.dom.getRenderedRect)) {
      const card = element.closest(companion.selectors.jobCard);
      const record = recordFor(jobUrl);
      if (card && record) targets.set(card, { jobUrl, record });
    }
    for (const badge of document.querySelectorAll(".jsc-analyzed-badge")) {
      if (!targets.has(badge.parentElement)) badge.remove();
    }
    for (const [card, { jobUrl, record }] of targets) {
      let link = card.querySelector(".jsc-analyzed-badge");
      if (!link) {
        link = createLink(jobUrl, record);
        link.classList.add("jsc-job-mark-badge", "jsc-analyzed-badge");
        card.append(link);
      }
      updateLink(link, jobUrl, record);
    }
    const heading = [...document.querySelectorAll(companion.selectors.jobDetailTitle)]
      .find((element) => companion.dom.getRenderedRect(element));
    let jobUrl;
    try { if (heading) jobUrl = companion.jobs.resolveSelectedJobUrl(); } catch { /* Ambiguous selection. */ }
    const record = jobUrl && recordFor(jobUrl);
    for (const link of document.querySelectorAll(".jsc-analysis-detail")) {
      if (!record || link.parentElement.previousElementSibling !== heading) link.remove();
    }
    // Job mark controls already provide the detail action container.
    const actions = heading?.nextElementSibling;
    if (record && actions?.classList.contains("jsc-job-actions")) {
      let link = actions.querySelector(".jsc-analysis-detail");
      if (!link) {
        link = createLink(jobUrl, record);
        link.classList.add("jsc-analysis-detail");
        actions.append(link);
      }
      updateLink(link, jobUrl, record);
    }
  };
  const schedule = () => {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      void ready.then(render).catch((error) => console.debug("Analysis records unavailable:", error));
    }, 100);
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    void ready.then(() => {
      for (const [key, { newValue }] of Object.entries(changes)) read(key, newValue);
      schedule();
    });
  });
  const sync = () => {
    if (document.visibilityState === "hidden") return;
    chrome.runtime.sendMessage({ type: globalThis.jobSearchContracts.messages.syncJobAnalyses }, () => {
      // Keep saved marks visible when the bridge is offline.
      void chrome.runtime.lastError;
    });
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ["href", "data-jk", "data-vjk", "data-jobkey", "componentkey"],
  });
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pageshow", sync);
  schedule();
  sync();
})();
