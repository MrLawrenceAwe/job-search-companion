(() => {
  const companion = globalThis.jobSearchCompanion;
  const marks = {
    applied: {
      badge: "✓ Applied",
      icon: "✓",
    },
    unsuitable: {
      badge: "✕ Unsuitable",
      icon: "✕",
    },
  };
  const store = companion.jobMarks.createStore();
  const { ready, isMarked } = store;

  const canMarkApplied = (jobUrl, cards = null) => {
    if (companion.platform !== "indeed") return true;

    // Read only this job's card; another result's Easily apply badge must
    // never decide whether the selected job supports manual tracking.
    const jobCards = cards || new Map(companion.jobs.collectJobCarriers().map(
      ({ element, jobUrl }) => [element.closest(companion.selectors.jobCard), jobUrl],
    ));
    for (const [card, cardJobUrl] of jobCards) {
      if (cardJobUrl === jobUrl && [...card?.querySelectorAll('span, div') || []].some(
        (element) => /^(?:easily|quick|indeed)\s+apply$/i.test(element.textContent.trim()),
      )) {
        return false;
      }
    }

    // The detail pane can belong to a different job from an open card menu.
    try {
      if (companion.jobs.resolvePageJobUrl() !== jobUrl) return true;
    } catch { return true; }
    const heading = [...document.querySelectorAll(companion.selectors.jobDetailTitle)]
      .find((element) => companion.dom.getRenderedRect(element));
    const pane = heading?.closest('[data-testid="viewjob-main-content"], #jobsearch-ViewjobPaneWrapper, .jobsearch-ViewJobLayout');
    if (!pane) return true;
    for (const control of pane.querySelectorAll('a[href], [data-testid="viewjob-indeed-apply"], #indeedApplyButton')) {
      if (!companion.dom.getRenderedRect(control)) continue;
      if (control.matches('[data-testid="viewjob-indeed-apply"], #indeedApplyButton')) return false;
      try {
        const url = new URL(control.getAttribute("href"), window.location.href);
        if ((url.hostname === "indeed.com" || url.hostname.endsWith(".indeed.com")) &&
            (url.hostname === "smartapply.indeed.com" || /\/indeedapply(?:\/|$)/i.test(url.pathname))) return false;
      } catch { /* Non-URL controls provide no application-route signal. */ }
    }
    return true;
  };

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
    button.disabled = store.isPending(jobUrl, kind);
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

  const render = ({ cards, jobUrl, actions }) => {
    for (const kind of Object.keys(marks)) {
      const badgeClass = `jsc-${kind}-badge`;
      const targets = new Map();
      for (const [card, cardJobUrl] of cards) {
        if (isMarked(cardJobUrl, kind)) targets.set(card, cardJobUrl);
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

    if (!jobUrl) {
      for (const button of actions?.querySelectorAll('.jsc-job-mark-action') || []) button.remove();
    } else if (actions) {
      for (const kind of Object.keys(marks)) {
        let button = actions.querySelector(`.jsc-${kind}-action`);
        if (kind === "applied" && !canMarkApplied(jobUrl, cards)) {
          button?.remove();
          continue;
        }
        if (!button) { button = createButton(jobUrl, kind); actions.append(button); }
        updateButton(button, jobUrl, kind);
      }
    }
    for (const button of document.querySelectorAll('.jsc-job-mark-action[role="menuitem"]')) {
      if (button.dataset.markKind === "applied" && !canMarkApplied(button.dataset.jobUrl, cards)) {
        button.remove();
        continue;
      }
      updateButton(button, button.dataset.jobUrl, button.dataset.markKind);
    }
  };
  store.subscribe(companion.pageDecorations.schedule);
  const toggle = async (jobUrl, kind, button = null) => {
    try {
      if (store.isPending(jobUrl, kind)) return false;
    } catch (error) {
      companion.showToast(error.message, "error");
      return false;
    }
    if (button) button.disabled = true;
    try {
      const marked = await store.toggle(jobUrl, kind);
      if (marked === null) return false;
      companion.pageDecorations.schedule();
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
      if (button) updateButton(button, button.dataset.jobUrl, kind);
    }
  };
  Object.assign(companion.jobMarks, { createButton, canMarkApplied });
  companion.pageDecorations.register(render, ready);
})();
