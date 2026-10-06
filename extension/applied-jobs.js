(() => {
  const cvFit = globalThis.cvFitBridge;
  const PREFIX = "applied-job:";
  const BADGE_CLASS = "cv-fit-bridge-applied-badge";
  const BUTTON_CLASS = "cv-fit-bridge-applied-action";
  const CARD_SELECTOR = 'li, [data-testid="slider_item"], .job_seen_beacon, .cardOutline, '
    + '[role="button"][componentkey^="job-card-component-ref-"]';
  const TITLE_SELECTOR = '[data-testid="vj-job-title"], .jobsearch-JobInfoHeader-title, '
    + '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title';
  const records = new Map();
  const pendingWrites = new Map();
  let renderTimer = null;

  // Use the platform job ID, so tracking parameters and country subdomains
  // cannot turn the same posting into multiple application records.
  const keyFor = (jobUrl) => {
    const normalized = cvFit.jobs.jobUrlFromPageUrl(jobUrl);
    if (!normalized) throw new Error("Couldn’t identify this job.");
    const url = new URL(normalized);
    const id = url.searchParams.get("jk") || url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
    return `${PREFIX}${url.hostname.includes("linkedin") ? "linkedin" : "indeed"}:${id}`;
  };

  const isApplied = (jobUrl) => Boolean(records.get(keyFor(jobUrl))?.appliedAt);
  const labelFor = (jobUrl) => isApplied(jobUrl) ? "Unmark as applied" : "Mark as applied";

  const updateButton = (button, jobUrl) => {
    button.dataset.jobUrl = jobUrl;
    const label = labelFor(jobUrl);
    const labelElement = button.querySelector(".cv-fit-bridge-menu-item-label") || button;
    if (labelElement.textContent !== label) labelElement.textContent = label;
    const pressed = String(isApplied(jobUrl));
    if (button.getAttribute("role") !== "menuitem" && button.getAttribute("aria-pressed") !== pressed) {
      button.setAttribute("aria-pressed", pressed);
    }
    button.title = "Your application record, saved in this Chrome profile";
  };

  const render = () => {
    if (!document.body) return;
    const targets = new Map();
    for (const { element, jobUrl } of cvFit.jobs.collectJobs(cvFit.dom.getRenderedRect)) {
      const card = element.closest(CARD_SELECTOR);
      if (card && isApplied(jobUrl)) targets.set(card, jobUrl);
    }
    for (const badge of document.querySelectorAll(`.${BADGE_CLASS}`)) {
      if (targets.get(badge.parentElement) !== badge.dataset.jobUrl) badge.remove();
    }
    for (const [card, jobUrl] of targets) {
      if (card.querySelector(`.${BADGE_CLASS}`)) continue;
      const badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      badge.dataset.jobUrl = jobUrl;
      badge.textContent = "✓ Applied";
      badge.title = "Marked as applied in Job Search Companion";
      card.append(badge);
    }

    // The job details can be replaced in place without a page navigation.
    const heading = [...document.querySelectorAll(TITLE_SELECTOR)]
      .find((element) => cvFit.dom.getRenderedRect(element));
    let jobUrl = null;
    if (heading) {
      try { jobUrl = cvFit.jobs.resolveSelectedJobUrl(); } catch { /* Ambiguous selection: omit the control. */ }
    }
    for (const button of document.querySelectorAll(`.${BUTTON_CLASS}:not([role="menuitem"])`)) {
      if (!jobUrl || button.previousElementSibling !== heading) button.remove();
    }
    if (jobUrl) {
      let button = heading.nextElementSibling;
      if (!button?.classList.contains(BUTTON_CLASS)) {
        button = document.createElement("button");
        button.type = "button";
        button.className = BUTTON_CLASS;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void toggle(button.dataset.jobUrl, button);
        });
        heading.after(button);
      }
      updateButton(button, jobUrl);
    }
    for (const button of document.querySelectorAll(`.${BUTTON_CLASS}[role="menuitem"]`)) {
      updateButton(button, button.dataset.jobUrl);
    }
  };

  const scheduleRender = () => {
    if (renderTimer !== null) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      void ready.then(render).catch((error) => console.debug("Application records unavailable:", error));
    }, 100);
  };

  const ready = chrome.storage.local.get(null).then((stored) => {
    for (const [key, value] of Object.entries(stored)) {
      if (key.startsWith(PREFIX) && typeof value?.appliedAt === "string") records.set(key, value);
    }
  });
  // Register before the initial read finishes; apply notifications afterwards
  // so an older storage snapshot never overwrites a newer change from another tab.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    void ready.then(() => {
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (!key.startsWith(PREFIX)) continue;
        if (typeof newValue?.appliedAt === "string") records.set(key, newValue);
        else records.delete(key);
      }
      scheduleRender();
    }).catch((error) => console.debug("Application record update failed:", error));
  });

  const toggle = async (jobUrl, button = null) => {
    let key;
    try { key = keyFor(jobUrl); } catch (error) {
      cvFit.showToast(error.message, "error");
      return false;
    }
    if (pendingWrites.has(key)) return false;
    pendingWrites.set(key, true);
    if (button) button.disabled = true;
    try {
      await ready;
      // Read this single record again to respect changes from another tab.
      const stored = await chrome.storage.local.get(key);
      const applied = !stored[key]?.appliedAt;
      if (applied) {
        const record = { jobUrl: cvFit.jobs.jobUrlFromPageUrl(jobUrl), appliedAt: new Date().toISOString() };
        await chrome.storage.local.set({ [key]: record });
        records.set(key, record);
      } else {
        await chrome.storage.local.remove(key);
        records.delete(key);
      }
      render();
      if (button) updateButton(button, jobUrl);
      cvFit.showToast(applied ? "Marked as applied." : "Applied mark removed.", "success");
      return true;
    } catch (error) {
      console.debug("Application record could not be saved:", error);
      cvFit.showToast("Couldn’t save the applied mark. Please reload the page and try again.", "error");
      return false;
    } finally {
      pendingWrites.delete(key);
      if (button) button.disabled = false;
    }
  };

  Object.assign(cvFit.appliedJobs, { isApplied, labelFor, ready, toggle, updateButton });
  const observer = new MutationObserver(scheduleRender);
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ["href", "data-jk", "data-vjk", "data-jobkey", "componentkey"],
  });
  window.addEventListener("popstate", scheduleRender);
  document.addEventListener("click", scheduleRender, true);
  scheduleRender();
})();
