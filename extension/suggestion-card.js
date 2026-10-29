(() => {
  if (window.top !== window || document.getElementById("jsc-suggestion-host")) return;
  const messages = globalThis.jobSearchContracts.messages;
  const { enabledKey } = globalThis.jobSearchContracts.recommendations;
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
  const show = (jobs) => {
    let index = 0;
    host = document.createElement("div");
    host.id = "jsc-suggestion-host";
    // The host page cannot read job checks, call card actions, or restyle this closed shadow tree.
    host.style.cssText = "all:initial!important;color-scheme:light dark!important;position:fixed!important;right:16px!important;top:16px!important;width:min(320px,calc(100vw - 32px))!important;z-index:2147483647!important;display:block!important;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host{--surface:#fff;--ink:#172535;--muted:#52677e;--border:#dce3eb;--shadow:#1026382b;--soft:#f3f6fa;--danger-surface:#fff1f2;--danger-border:#fecdd3;--danger:#b42318;--button-ink:#233c56;--hover:#edf3f9;--focus:#87b7f0;--primary:#205da8;--primary-ink:#fff}
      @media (prefers-color-scheme:dark){:host{--surface:#18212d;--ink:#e8edf5;--muted:#aab8cb;--border:#354458;--shadow:#0008;--soft:#222e3e;--danger-surface:#3b2028;--danger-border:#884452;--danger:#fda4af;--button-ink:#d6e5f7;--hover:#2b3a4e;--focus:#a1c9ff;--primary:#8bbcff;--primary-ink:#10243f}}
      *{box-sizing:border-box}
      article{font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 8px 30px var(--shadow);padding:15px;max-height:70vh;overflow:auto}
      small{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}
      h2{font-size:16px;line-height:1.3;margin:8px 0 5px;overflow-wrap:anywhere}
      p{margin:7px 0;color:var(--muted)} .pay{font-weight:600;color:var(--ink)}
      details,.check-error{margin:10px 0;padding:8px 10px;border-radius:8px;background:var(--soft)}
      details.has-blockers{background:var(--danger-surface);border:1px solid var(--danger-border)}
      details.has-blockers summary,details.has-blockers blockquote,details.has-blockers li p{color:var(--danger)}
      summary{cursor:pointer;font-weight:600} li{margin:12px 0} blockquote{margin:0 0 6px;font-weight:600} ul{padding-left:17px;margin:0}
      .navigation{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-weight:600}.navigation button{padding:3px 12px;font-size:18px}
      .actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
      button{font:inherit;font-size:12px;font-weight:600;padding:8px 6px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--button-ink);cursor:pointer}button:hover{background:var(--hover)}button:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
      button.primary{background:var(--primary);color:var(--primary-ink);border-color:var(--primary)}button:disabled{opacity:.55;cursor:wait}.feedback{font-size:12px;color:var(--danger)}
    `;
    const render = () => {
    const job = jobs[index];
    const article = document.createElement("article");
    article.setAttribute("aria-label", "Job Search Companion suggestion");
    const element = (tag, text, className) => {
      const node = document.createElement(tag);
      node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    if (jobs.length > 1) {
      const navigation = element("nav", "", "navigation");
      navigation.setAttribute("aria-label", "Suggested jobs");
      const previous = element("button", "‹");
      previous.type = "button"; previous.setAttribute("aria-label", "Previous suggested job"); previous.disabled = index === 0;
      const next = element("button", "›");
      next.type = "button"; next.setAttribute("aria-label", "Next suggested job"); next.disabled = index === jobs.length - 1;
      previous.addEventListener("click", (event) => { if (event.isTrusted && index > 0) { index--; render(); } });
      next.addEventListener("click", (event) => { if (event.isTrusted && index < jobs.length - 1) { index++; render(); } });
      navigation.append(previous, element("span", `${index + 1} of ${jobs.length}`), next);
      article.append(navigation);
    }
    article.append(element("small", job.suggestionKind === "toApply" ? "Job Search Companion · To apply" : "Job Search Companion · Indeed"), element("h2", job.title),
      element("p", [job.company, job.location].filter(Boolean).join(" · ")),
      element("p", job.pay, "pay"));
    if (job.suggestionKind === "toApply") article.append(element("p", `CV Fit Advisor: ${job.analysisLabel}`));
    const check = job.blockerCheck;
    if (check.status === "completed") {
      const details = document.createElement("details");
      const count = check.findings.length;
      if (count) details.className = "has-blockers";
      details.append(element("summary", `${count} potential blocker${count === 1 ? "" : "s"}`));
      if (!count) details.append(element("p", "No blockers found by the check. Review the job before applying."));
      else {
        const list = document.createElement("ul");
        for (const finding of check.findings) {
          const row = document.createElement("li");
          row.append(element("blockquote", finding.requirementQuote), element("p", finding.explanation));
          list.append(row);
        }
        details.append(list);
      }
      article.append(details);
    } else article.append(element("p", check.status === "incomplete"
      ? "Blocker check incomplete: the full description wasn’t available."
      : "Blocker check failed or unavailable. No blocker count is known.", "check-error"));
    const actions = element("div", "", "actions");
    const snooze = document.createElement("details");
    snooze.append(element("summary", "Snooze"));
    const snoozeChoices = element("div", "", "actions");
    snooze.append(snoozeChoices);
    const feedback = element("p", "", "feedback");
    feedback.setAttribute("role", "status");
    const labels = [["open", "Open job"], job.suggestionKind === "toApply"
      ? ["review", "View CV Fit Advisor"] : ["analyse", "Analyse with CV Fit Advisor"], ["unsuitable", "Mark as unsuitable"], ["dismiss", "Dismiss"]];
    labels.push(...[1, 2, 3, 4, 5].map((hours) => ["snooze", `${hours} hour${hours === 1 ? "" : "s"}`, hours]));
    let busy = false;
    for (const [action, label, hours] of labels) {
      const button = element("button", label, action === "open" ? "primary" : "");
      button.type = "button";
      button.addEventListener("click", async (event) => {
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
            if (!host || !enabled) return;
            const done = element("button", "Continue");
            done.type = "button";
            done.addEventListener("click", (event) => { if (event.isTrusted) advance(); });
            actions.replaceChildren(done);
            snooze.remove();
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
      });
      (action === "snooze" ? snoozeChoices : actions).append(button);
    }
    article.append(actions, snooze, feedback);
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
