(() => {
  const companion = globalThis.jobSearchCompanion;
  const pendingRoots = new Set();
  let scanDeadline = 0;
  let insertionTimer = null;

  const observer = new MutationObserver((mutations) => {
    if (!isScanActive()) {
      stopMenuScan();
      return;
    }

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }

        const menuRoot = companion.shareMenu.findMenuRoot(node);
        if (menuRoot || companion.shareMenu.mightContainMenu(node)) {
          scheduleJobMenuActionInsertion(menuRoot || node);
        }
      }
    }
  });

  const tryInsertJobMenuActions = (root = document.body) => {
    if (!document.body) {
      return false;
    }

    try {
      return companion.shareMenu.insertJobMenuActions(root);
    } catch (error) {
      console.debug("CV Fit menu insertion skipped:", error);
      return false;
    }
  };

  const addPendingRoot = (root) => {
    if (!root) {
      return;
    }

    for (const pendingRoot of pendingRoots) {
      if (pendingRoot === root || pendingRoot.contains?.(root)) {
        return;
      }
      if (root.contains?.(pendingRoot)) {
        pendingRoots.delete(pendingRoot);
      }
    }
    pendingRoots.add(root);
  };

  const visibleMenuRoots = () => {
    return [...document.querySelectorAll(companion.selectors.menuContext)].filter((element) =>
      companion.dom.getViewportRect(element),
    );
  };

  const isScanActive = () => Date.now() <= scanDeadline;

  const stopMenuScan = () => {
    scanDeadline = 0;
    pendingRoots.clear();
    window.clearTimeout(insertionTimer);
    insertionTimer = null;
    observer.disconnect();
  };

  const scheduleJobMenuActionInsertion = (root = null, delay = 40) => {
    addPendingRoot(root);
    window.clearTimeout(insertionTimer);
    insertionTimer = window.setTimeout(() => {
      insertionTimer = null;
      const roots = [...pendingRoots];
      pendingRoots.clear();

      if (roots.length === 0) {
        roots.push(...visibleMenuRoots());
      }
      for (const pendingRoot of roots) {
        if (tryInsertJobMenuActions(pendingRoot)) {
          stopMenuScan();
          return;
        }
      }
      if (isScanActive()) {
        scheduleJobMenuActionInsertion(null, companion.shareMenuDetection.retryIntervalMs);
      } else {
        stopMenuScan();
      }
    }, delay);
  };

  const startMenuScan = () => {
    scanDeadline = Date.now() + companion.shareMenuDetection.scanWindowMs;
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  };

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target?.closest?.('button, [role="button"], [aria-label*="share" i]');
      const label = `${button?.getAttribute?.("aria-label") || ""} ${button?.textContent || ""}`;
      if (/\bshare\b|\bmore options\b/i.test(label)) {
        companion.jobs.captureShareContext(button);
        startMenuScan();
        scheduleJobMenuActionInsertion();
      }
    },
    true,
  );
})();
