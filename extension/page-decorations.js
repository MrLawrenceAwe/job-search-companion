(() => {
  const companion = globalThis.jobSearchCompanion;
  const renderers = new Set();
  const pageChangeListeners = new Set();
  const ownedElements = '.jsc-detail-controls, .jsc-job-mark-badge, .jsc-blocker-badge, .jsc-menu-item, .jsc-to-apply';
  const jobContent = [
    companion.selectors.jobUrlCarrier,
    companion.selectors.jobDetailTitle,
    '#jobDescriptionText, [data-testid="viewjob-job-content"], [data-testid="viewjob-main-content"]',
    '#jobsearch-ViewjobPaneWrapper, .jobsearch-ViewJobLayout, .jobs-details',
    '[data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails"]',
    // Resolution can also depend on fallback headings and embedded page data.
    'h1, h2, #alert-content, link[rel="canonical"], script',
  ].join(', ');
  let renderTimer = null;
  let detailHeading = null;
  let detailControls = null;
  let renderedCards = new Set();

  const preparePageDecorations = () => {
    const cards = new Map();
    for (const { element, jobUrl } of companion.jobs.collectJobCarriers(companion.dom.getRenderedRect)) {
      const card = element.closest(companion.selectors.jobCard);
      if (card) cards.set(card, jobUrl);
    }
    renderedCards = new Set(cards.keys());
    const heading = companion.jobs.findRenderedDetailHeading();
    let jobUrl = null;
    try {
      // Keyboard selection can advance before the displayed pane finishes loading.
      if (heading) jobUrl = companion.jobs.resolvePageJobUrl();
    } catch { /* Ambiguous selection: features omit job-specific controls. */ }
    if (heading !== detailHeading || (heading && !detailControls?.isConnected)) {
      detailControls?.remove();
      detailHeading = heading;
      detailControls = null;
      if (heading) {
        detailControls = document.createElement('div');
        detailControls.className = 'jsc-detail-controls';
        for (const className of ['jsc-job-actions', 'jsc-job-findings']) {
          const container = document.createElement('div');
          container.className = className;
          detailControls.append(container);
        }
        heading.after(detailControls);
      }
    }
    return {
      cards, heading, jobUrl,
      actions: detailControls?.querySelector('.jsc-job-actions') || null,
      findings: detailControls?.querySelector('.jsc-job-findings') || null,
    };
  };
  const schedule = () => {
    if (renderTimer !== null) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      if (!document.body) return;
      const page = preparePageDecorations();
      for (const render of renderers) {
        try { render(page); }
        catch (error) { console.debug('Job page decoration failed:', error); }
      }
    }, 100);
  };
  const isOwned = (node) => Boolean(
    (node.nodeType === 1 ? node : node.parentElement)?.closest?.(ownedElements),
  );
  const pageChanged = () => {
    schedule();
    for (const listener of pageChangeListeners) listener();
  };
  const isJobContext = (node) => {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || isOwned(element)) return false;
    if (element.closest(jobContent)) return true;
    const card = element.closest(companion.selectors.jobCard);
    // Keep changes to reused cards relevant even after their carrier is removed.
    return Boolean(card && (renderedCards.has(card) || card.querySelector(companion.selectors.jobUrlCarrier)));
  };
  const containsJobContent = (node) => node.nodeType === 1 && !isOwned(node) && (
    node.matches(jobContent) || node.querySelector(jobContent) ||
    renderedCards.has(node) || (detailHeading && node.contains(detailHeading))
  );
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => {
      if (isOwned(mutation.target)) return false;
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      if (changedNodes.length && changedNodes.every(isOwned)) return false;
      return isJobContext(mutation.target) || changedNodes.some(containsJobContent);
    })) pageChanged();
  }).observe(document.documentElement || document, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['href', 'data-jk', 'data-vjk', 'data-jobkey', 'componentkey'],
  });
  window.addEventListener('popstate', pageChanged);
  document.addEventListener('click', pageChanged, true);
  companion.pageDecorations = Object.freeze({
    schedule,
    subscribe(listener) {
      pageChangeListeners.add(listener);
      return () => pageChangeListeners.delete(listener);
    },
    register(render, ready = Promise.resolve()) {
      void ready.then(() => { renderers.add(render); schedule(); })
        .catch((error) => console.debug('Job decoration data unavailable:', error));
    },
  });
})();
