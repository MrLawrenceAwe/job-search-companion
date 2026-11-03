(() => {
  if (window.top !== window || document.getElementById("jsc-suggestion-host")) return;
  const messages = globalThis.jobSearchContracts.messages;
  const { enabledKey } = globalThis.jobSearchContracts.suggestionDeliveryPreferences;
  let enabled = false;
  let settingGeneration = 0;
  let suspended = false;
  let host = null;
  const close = () => { host?.remove(); host = null; };
  const applyEnabled = (value) => {
    settingGeneration++;
    enabled = value !== false;
    if (!enabled) close();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.hasOwn(changes, enabledKey)) return;
    applyEnabled(changes[enabledKey].newValue);
    if (enabled) void poll();
  });
  let polling = false;
  let stopped = false;
  const poll = async () => {
    if (stopped || suspended || !enabled || polling || host || document.visibilityState !== "visible") return;
    polling = true;
    const generation = settingGeneration;
    try {
      const response = await chrome.runtime.sendMessage({ type: messages.pollSuggestion });
      if (response?.jobs?.length && enabled && !suspended && generation === settingGeneration && document.visibilityState === "visible") show(response.jobs);
    } catch { stopped = true; }
    finally { polling = false; }
  };
  const showSubmissionResult = async (response, feedback) => {
    const client = globalThis.jobSearchCvFitClient;
    feedback.textContent = "Submitting to Codex…";
    try {
      if (response.uncertain) throw Object.assign(new Error(response.error), { uncertain: true });
      const sendRequest = async (message) => {
        const result = await chrome.runtime.sendMessage(message);
        if (!result?.ok) throw new Error(result?.error || "Submission status unavailable");
        return result;
      };
      const { waitForSubmissionResult } = client.createClient(sendRequest);
      const status = await waitForSubmissionResult(response.submission.id);
      feedback.textContent = client.resultMessage(status);
    } catch (error) {
      feedback.textContent = client.failureMessage(error, true).message;
    }
  };
  const show = (jobs) => {
    let index = 0;
    host = document.createElement("div");
    host.id = "jsc-suggestion-host";
    // The host page cannot read job checks, call card actions, or restyle this closed shadow tree.
    host.style.cssText = "all:initial!important;color-scheme:light dark!important;position:fixed!important;right:16px!important;top:16px!important;width:min(320px,calc(100vw - 32px))!important;z-index:2147483647!important;display:block!important;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = globalThis.jobSearchSuggestionStyles;
    const render = () => {
      const job = jobs[index];
      let busy = false;
      const { article, feedback, showContinue } = globalThis.jobSearchSuggestionRenderer.createView({
        job, index, jobCount: jobs.length,
        onNavigate: (direction) => { index += direction; render(); },
        onAction: async (event, action, hours, button) => {
          if (!event.isTrusted || busy) return;
          busy = true;
          for (const control of article.querySelectorAll("button")) control.disabled = true;
          try {
            const response = await chrome.runtime.sendMessage({ type: messages.actOnSuggestion, action, hours, jobUrl: job.jobUrl });
            if (!response?.ok) throw Object.assign(new Error(response?.error || "Couldn’t complete that action. Please try again."), { definiteFailure: Boolean(response) });
            if (!host || !enabled) return;
            const advance = () => {
              jobs.splice(index, 1);
              if (!jobs.length) close();
              else { index = Math.min(index, jobs.length - 1); render(); }
            };
            if (action === "analyse") {
              await showSubmissionResult(response, feedback);
              if (!host || !enabled) return;
              showContinue(advance);
            } else if (action === "snooze") close();
            else advance();
          } catch (error) {
            const uncertainStart = action === "analyse" && !error.definiteFailure;
            feedback.textContent = uncertainStart
              ? globalThis.jobSearchCvFitClient.failureMessage(Object.assign(error, { uncertain: true })).message
              : error.message;
            for (const control of article.querySelectorAll("button")) control.disabled = false;
            if (uncertainStart) button.disabled = true;
            const previous = article.querySelector('[aria-label="Previous suggested job"]');
            const next = article.querySelector('[aria-label="Next suggested job"]');
            if (previous) previous.disabled = index === 0;
            if (next) next.disabled = index === jobs.length - 1;
          } finally { busy = false; }
        },
      });
      root.replaceChildren(style, article);
    };
    render();
    document.documentElement.append(host);
    // Deliberately no focus(), dialog, alert, sound, scroll, or foreground navigation.
  };
  document.addEventListener("visibilitychange", poll);
  let timer = null;
  const startPolling = () => {
    suspended = false;
    if (timer === null) timer = setInterval(poll, 60_000);
    // Refresh settings after a cached document was suspended.
    const generation = settingGeneration;
    void chrome.storage.local.get(enabledKey).then((saved) => {
      if (generation === settingGeneration) applyEnabled(saved[enabledKey]);
      void poll();
    }).catch(() => {});
  };
  window.addEventListener("pagehide", () => {
    suspended = true;
    settingGeneration++;
    clearInterval(timer);
    timer = null;
  });
  window.addEventListener("pageshow", startPolling);
  startPolling();
})();
