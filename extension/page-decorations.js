(() => {
  const companion = globalThis.jobSearchCompanion;
  const renderers = new Set();
  const pageChangeListeners = new Set();
  const ownedElements = '.jsc-detail-controls, .jsc-job-mark-badge, .jsc-blocker-badge, .jsc-menu-item';
  let renderTimer = null;
  let detailHeading = null;
  let detailControls = null;

  const readPage = () => {
    const cards = new Map();
    for (const { element, jobUrl } of companion.jobs.collectJobCarriers(companion.dom.getRenderedRect)) {
      const card = element.closest(companion.selectors.jobCard);
      if (card) cards.set(card, jobUrl);
    }
    const heading = [...document.querySelectorAll(companion.selectors.jobDetailTitle)]
      .find((element) => companion.dom.getRenderedRect(element)) || null;
    let jobUrl = null;
    try {
      if (heading) jobUrl = companion.jobs.resolveSelectedJobUrl();
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
      const page = readPage();
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
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => {
      if (isOwned(mutation.target)) return false;
      const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return !changedNodes.length || changedNodes.some((node) => !isOwned(node));
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
