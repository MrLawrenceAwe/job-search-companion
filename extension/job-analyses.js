(() => {
  const companion = globalThis.jobSearchCompanion;
  const contract = globalThis.jobSearchContracts.jobAnalyses;
  const store = companion.jobAnalysisStore;
  const { ready } = store;
  const recordFor = store.get;
  const updateAnalysisButton = (button, jobUrl, record) => {
    button.dataset.jobUrl = jobUrl;
    button.dataset.verdictColor = contract.colorFor(record.verdict);
    button.title = `${contract.labelFor(record.verdict)} — Open completed CV-fit analysis in Codex (${new Date(record.analyzedAt).toLocaleDateString()})`;
  };
  const createAnalysisButton = (jobUrl, record) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jsc-analysis-button";
    button.textContent = "Open analysis";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      chrome.runtime.sendMessage({
        type: globalThis.jobSearchContracts.messages.openJobAnalysis, jobUrl: button.dataset.jobUrl,
      }, (response) => {
        button.disabled = false;
        if (chrome.runtime.lastError || !response?.ok) {
          companion.showToast(response?.error || "Couldn’t open the analysis. Check that the local bridge is running.", "error");
        }
      });
    });
    updateAnalysisButton(button, jobUrl, record);
    return button;
  };
  const render = ({ cards, jobUrl, actions }) => {
    const targets = new Map();
    for (const [card, cardJobUrl] of cards) {
      const record = recordFor(cardJobUrl);
      if (record) targets.set(card, { jobUrl: cardJobUrl, record });
    }
    for (const badge of document.querySelectorAll(".jsc-analyzed-badge")) {
      if (!targets.has(badge.parentElement)) badge.remove();
    }
    for (const [card, { jobUrl, record }] of targets) {
      let button = card.querySelector(".jsc-analyzed-badge");
      if (!button) {
        button = createAnalysisButton(jobUrl, record);
        button.classList.add("jsc-job-mark-badge", "jsc-analyzed-badge");
        card.append(button);
      }
      updateAnalysisButton(button, jobUrl, record);
    }
    const record = jobUrl && recordFor(jobUrl);
    if (!record) actions?.querySelector('.jsc-analysis-detail')?.remove();
    if (record && actions) {
      let button = actions.querySelector(".jsc-analysis-detail");
      if (!button) {
        button = createAnalysisButton(jobUrl, record);
        button.classList.add("jsc-analysis-detail");
        actions.append(button);
      }
      updateAnalysisButton(button, jobUrl, record);
    }
  };
  store.subscribe(companion.pageDecorations.schedule);
  const sync = () => {
    if (document.visibilityState === "hidden") return;
    chrome.runtime.sendMessage({ type: globalThis.jobSearchContracts.messages.syncJobAnalyses }, () => {
      // Keep saved marks visible when the bridge is offline.
      void chrome.runtime.lastError;
    });
  };
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("pageshow", sync);
  companion.pageDecorations.register(render, ready);
  sync();
})();
