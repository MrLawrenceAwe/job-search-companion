(() => {
  const companion = globalThis.jobSearchCompanion;
  const MAX_UNDO_ACTIONS = 100;
  const undoActions = [];
  const hiddenJobUrls = new Set();
  let lastNavigatedJobUrl = null;
  let pageJobUrlAtSelection = null;
  let hiddenJobObserver = null;

  const uniqueJobs = (jobEntries) => {
    const jobsByUrl = new Map();
    for (const jobEntry of jobEntries) {
      if (!jobsByUrl.has(jobEntry.jobUrl)) {
        jobsByUrl.set(jobEntry.jobUrl, jobEntry);
      }
    }
    return [...jobsByUrl.values()];
  };

  const allJobs = () => uniqueJobs(companion.jobs.collectJobCarriers());

  const renderedJobs = () =>
    uniqueJobs(companion.jobs.collectJobCarriers(companion.dom.getRenderedRect)).filter(
      ({ jobUrl }) => !hiddenJobUrls.has(jobUrl),
    );

  const reconcileHiddenJobCards = () => {
    const cards = new Map();
    // Include hidden carriers so a card reused for another job becomes visible.
    for (const { element, jobUrl } of companion.jobs.collectJobCarriers()) {
      const card = element.closest?.(companion.selectors.jobCard) || element;
      cards.set(card, cards.get(card) || hiddenJobUrls.has(jobUrl));
    }
    for (const [card, hidden] of cards) {
      if (hidden) card.classList?.add("jsc-hidden-job");
      else card.classList?.remove("jsc-hidden-job");
    }
  };

  const observeHiddenJobs = () => {
    if (!hiddenJobObserver) {
      hiddenJobObserver = new MutationObserver(reconcileHiddenJobCards);
    }
    hiddenJobObserver.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "data-jk", "data-vjk", "data-jobkey", "id", "componentkey"],
    });
  };

  const selectJob = (job) => {
    const clickable = job.element.matches?.('a[href], button, [role="button"]')
      ? job.element
      : job.element.querySelector?.('a[href], button, [role="button"]') || job.element;
    if (typeof clickable.click !== "function") {
      return false;
    }

    const previousPageJobUrl = companion.jobs.jobUrlFromPageUrl(window.location.href);
    clickable.scrollIntoView?.({ block: "center", inline: "nearest" });
    clickable.focus?.({ preventScroll: true });
    clickable.click();
    lastNavigatedJobUrl = job.jobUrl;
    pageJobUrlAtSelection = previousPageJobUrl;
    return true;
  };

  const rememberUndoAction = (action) => {
    undoActions.push(action);
    if (undoActions.length > MAX_UNDO_ACTIONS) {
      undoActions.shift();
    }
  };

  const currentRenderedJob = (jobs) => {
    try {
      const currentJobUrl = resolveSelectedJobUrl(jobs);
      return jobs.find(({ jobUrl }) => jobUrl === currentJobUrl) || null;
    } catch {
      return null;
    }
  };

  const resolveSelectedJobUrl = (jobs = null) => {
    if (
      lastNavigatedJobUrl !== null &&
      (jobs || renderedJobs()).some(({ jobUrl }) => jobUrl === lastNavigatedJobUrl)
    ) {
      const pageJobUrl = companion.jobs.jobUrlFromPageUrl(window.location.href);
      if (
        pageJobUrl &&
        pageJobUrl !== lastNavigatedJobUrl &&
        pageJobUrl !== pageJobUrlAtSelection
      ) {
        lastNavigatedJobUrl = pageJobUrl;
        pageJobUrlAtSelection = pageJobUrl;
      }
      return lastNavigatedJobUrl;
    }
    return companion.jobs.resolvePageJobUrl();
  };

  const rememberInteractedJob = (event) => {
    if (lastNavigatedJobUrl === null || event.isTrusted === false) {
      return;
    }

    const jobs = renderedJobs();
    const carrier = event.target?.closest?.(companion.selectors.jobUrlCarrier);
    const container = event.target?.closest?.(companion.selectors.jobCard);
    const interactedJob = jobs.find(
      ({ element }) =>
        element === event.target ||
        element === carrier ||
        element.contains?.(event.target) ||
        carrier?.contains?.(element) ||
        container?.contains?.(element),
    );
    if (interactedJob) {
      lastNavigatedJobUrl = interactedJob.jobUrl;
      pageJobUrlAtSelection = companion.jobs.jobUrlFromPageUrl(window.location.href);
    }
  };

  document.addEventListener?.("click", rememberInteractedJob, true);
  window.addEventListener?.("popstate", () => {
    // A history change is distinct from the stale URL during a pending card click.
    pageJobUrlAtSelection = null;
  });

  const navigateJob = (direction) => {
    if (![1, -1].includes(direction)) {
      throw new TypeError("Job navigation direction must be 1 or -1");
    }

    const jobs = renderedJobs();
    const previousJob = currentRenderedJob(jobs);
    if (jobs.length === 0 || (lastNavigatedJobUrl === null && direction === -1)) {
      return false;
    }

    const currentIndex =
      lastNavigatedJobUrl === null
        ? -1
        : jobs.indexOf(previousJob);
    const target = jobs[currentIndex + direction];
    if (!target) {
      return false;
    }

    if (!selectJob(target)) {
      return false;
    }
    rememberUndoAction({
      type: "navigation",
      previousJobUrl: previousJob?.jobUrl || null,
    });
    return true;
  };

  const hideCurrentJob = () => {
    const jobs = renderedJobs();
    const currentJob = currentRenderedJob(jobs);
    if (!currentJob) {
      return false;
    }

    const currentIndex = jobs.indexOf(currentJob);
    const container =
      currentJob.element.closest?.(companion.selectors.jobCard) || currentJob.element;
    if (!container.classList) {
      return false;
    }

    container.classList.add("jsc-hidden-job");
    hiddenJobUrls.add(currentJob.jobUrl);
    observeHiddenJobs();
    const replacement = jobs[currentIndex + 1] || jobs[currentIndex - 1] || null;
    lastNavigatedJobUrl = null;
    pageJobUrlAtSelection = null;
    if (replacement) {
      selectJob(replacement);
    }
    rememberUndoAction({ type: "hide", container, jobUrl: currentJob.jobUrl });
    return true;
  };

  const undoLastJobAction = () => {
    const lastAction = undoActions.at(-1);
    if (!lastAction) {
      return false;
    }

    if (lastAction.type === "hide") {
      hiddenJobUrls.delete(lastAction.jobUrl);
      if (hiddenJobUrls.size === 0) {
        hiddenJobObserver?.disconnect();
      }
      lastAction.container.classList.remove("jsc-hidden-job");
      for (const { element, jobUrl } of companion.jobs.collectJobCarriers()) {
        if (jobUrl === lastAction.jobUrl) {
          (element.closest?.(companion.selectors.jobCard) || element).classList?.remove(
            "jsc-hidden-job",
          );
        }
      }
      undoActions.pop();
      const currentJob = allJobs().find(({ jobUrl }) => jobUrl === lastAction.jobUrl);
      if (currentJob) {
        selectJob(currentJob);
      } else {
        lastNavigatedJobUrl = null;
        pageJobUrlAtSelection = null;
      }
      return true;
    }

    if (lastAction.previousJobUrl === null) {
      lastNavigatedJobUrl = null;
      pageJobUrlAtSelection = null;
      undoActions.pop();
      return true;
    }

    const previousJob = renderedJobs().find(({ jobUrl }) => jobUrl === lastAction.previousJobUrl);
    if (!previousJob || !selectJob(previousJob)) {
      return false;
    }
    undoActions.pop();
    return true;
  };

  Object.assign(companion.jobs, {
    hideCurrentJob,
    navigateJob,
    resolveSelectedJobUrl,
    undoLastJobAction,
  });
})();
