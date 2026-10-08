(() => {
  const companion = globalThis.jobSearchCompanion;
  const marks = {
    applied: {
      prefix: "applied-job:",
      timestamp: "appliedAt",
      badge: "✓ Applied",
      icon: "✓",
    },
    unsuitable: {
      prefix: "unsuitable-job:",
      timestamp: "unsuitableAt",
      badge: "✕ Unsuitable",
      icon: "✕",
    },
  };
  const ACTIONS_CLASS = "jsc-job-actions";
  const records = new Map();
  const pendingWrites = new Set();
  let renderTimer = null;

  // Keep existing application records under their saved keys. Both marks use
  // platform IDs so country hosts and tracking parameters share one identity.
  const keyFor = (jobUrl, kind) => {
    const normalized = companion.jobs.jobUrlFromPageUrl(jobUrl);
    if (!normalized) throw new Error("Couldn’t identify this job.");
    const url = new URL(normalized);
    const id = url.searchParams.get("jk") || url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
    return `${marks[kind].prefix}${url.hostname.includes("linkedin") ? "linkedin" : "indeed"}:${id}`;
  };
  const isMarked = (jobUrl, kind) =>
    Boolean(records.get(keyFor(jobUrl, kind))?.[marks[kind].timestamp]);
  const updateButton = (button, jobUrl, kind) => {
    button.dataset.jobUrl = jobUrl;
    button.dataset.markKind = kind;
    const label = `${isMarked(jobUrl, kind) ? "Unmark" : "Mark"} as ${kind}`;
    const labelElement = button.querySelector(".jsc-menu-item-label") || button;
    if (labelElement.textContent !== label) labelElement.textContent = label;
    const pressed = String(isMarked(jobUrl, kind));
    if (
      button.getAttribute("role") !== "menuitem" &&
      button.getAttribute("aria-pressed") !== pressed
    ) {
      button.setAttribute("aria-pressed", pressed);
    }
    button.title = "Your job record, saved in this Chrome profile";
    button.disabled = pendingWrites.has(keyFor(jobUrl, kind));
  };
  const createButton = (jobUrl, kind, menu = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `jsc-job-mark-action jsc-${kind}-action`;
    if (menu) {
      button.className += ` ${companion.ui.menuItemClass}`;
      button.setAttribute("role", "menuitem");
      const icon = document.createElement("span");
      icon.className = "jsc-menu-item-icon";
      icon.textContent = marks[kind].icon;
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "jsc-menu-item-label";
      button.append(icon);
      button.append(label);
    }
    updateButton(button, jobUrl, kind);
    void ready
      .then(() => updateButton(button, button.dataset.jobUrl, kind))
      .catch(() => {
        button.disabled = true;
      });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void toggle(button.dataset.jobUrl, kind, button);
    });
    return button;
  };

  const render = () => {
    if (!document.body) return;
    const jobs = companion.jobs.collectJobs(companion.dom.getRenderedRect);
    for (const kind of Object.keys(marks)) {
      const badgeClass = `jsc-${kind}-badge`;
      const targets = new Map();
      for (const { element, jobUrl } of jobs) {
        const card = element.closest(companion.selectors.jobCard);
        if (card && isMarked(jobUrl, kind)) targets.set(card, jobUrl);
      }
      for (const badge of document.querySelectorAll(`.${badgeClass}`)) {
        if (targets.get(badge.parentElement) !== badge.dataset.jobUrl) badge.remove();
      }
      for (const [card, jobUrl] of targets) {
        if (card.querySelector(`.${badgeClass}`)) continue;
        const badge = document.createElement("span");
        badge.className = `jsc-job-mark-badge ${badgeClass}`;
        badge.dataset.jobUrl = jobUrl;
        badge.textContent = marks[kind].badge;
        badge.title = `Marked as ${kind} in Job Search Companion`;
        card.append(badge);
      }
    }

    const heading = [...document.querySelectorAll(companion.selectors.jobDetailTitle)].find(
      (element) => companion.dom.getRenderedRect(element),
    );
    let jobUrl = null;
    if (heading) {
      try {
        jobUrl = companion.jobs.resolveSelectedJobUrl();
      } catch {
        /* Ambiguous selection: omit controls. */
      }
    }
    for (const actions of document.querySelectorAll(`.${ACTIONS_CLASS}`)) {
      if (!jobUrl || actions.previousElementSibling !== heading) actions.remove();
    }
    if (jobUrl) {
      let actions = heading.nextElementSibling;
      if (!actions?.classList.contains(ACTIONS_CLASS)) {
        actions = document.createElement("div");
        actions.className = ACTIONS_CLASS;
        for (const kind of Object.keys(marks)) actions.append(createButton(jobUrl, kind));
        heading.after(actions);
      }
      for (const button of actions.querySelectorAll(".jsc-job-mark-action")) {
        updateButton(button, jobUrl, button.dataset.markKind);
      }
    }
    for (const button of document.querySelectorAll('.jsc-job-mark-action[role="menuitem"]')) {
      updateButton(button, button.dataset.jobUrl, button.dataset.markKind);
    }
  };
  const scheduleRender = () => {
    if (renderTimer !== null) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      void ready.then(render).catch((error) => console.debug("Job records unavailable:", error));
    }, 100);
  };
  const readRecord = (key, value) => {
    const mark = Object.values(marks).find(({ prefix }) => key.startsWith(prefix));
    if (!mark) return;
    if (typeof value?.[mark.timestamp] === "string") records.set(key, value);
    else records.delete(key);
  };
  const ready = chrome.storage.local.get(null).then((stored) => {
    for (const [key, value] of Object.entries(stored)) readRecord(key, value);
  });
  // Apply notifications after the initial snapshot so newer changes win.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    void ready
      .then(() => {
        for (const [key, { newValue }] of Object.entries(changes)) readRecord(key, newValue);
        scheduleRender();
      })
      .catch((error) => console.debug("Job record update failed:", error));
  });
  const toggle = async (jobUrl, kind, button = null) => {
    let key;
    try {
      key = keyFor(jobUrl, kind);
    } catch (error) {
      companion.showToast(error.message, "error");
      return false;
    }
    if (pendingWrites.has(key)) return false;
    pendingWrites.add(key);
    if (button) button.disabled = true;
    try {
      await ready;
      const stored = await chrome.storage.local.get(key);
      const marked = !stored[key]?.[marks[kind].timestamp];
      if (marked) {
        const record = {
          jobUrl: companion.jobs.jobUrlFromPageUrl(jobUrl),
          [marks[kind].timestamp]: new Date().toISOString(),
        };
        await chrome.storage.local.set({ [key]: record });
        records.set(key, record);
      } else {
        await chrome.storage.local.remove(key);
        records.delete(key);
      }
      render();
      companion.showToast(
        marked
          ? `Marked as ${kind}.`
          : `${kind === "applied" ? "Applied" : "Unsuitable"} mark removed.`,
        "success",
      );
      return true;
    } catch (error) {
      console.debug("Job record could not be saved:", error);
      companion.showToast(
        `Couldn’t save the ${kind} mark. Please reload the page and try again.`,
        "error",
      );
      return false;
    } finally {
      pendingWrites.delete(key);
      if (button) updateButton(button, button.dataset.jobUrl, kind);
    }
  };
  Object.assign(companion.jobMarks, { createButton });
  new MutationObserver(scheduleRender).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "data-jk", "data-vjk", "data-jobkey", "componentkey"],
  });
  window.addEventListener("popstate", scheduleRender);
  document.addEventListener("click", scheduleRender, true);
  scheduleRender();
})();
