(() => {
  const cvFit = globalThis.cvFitBridge;

  const queryIncludingRoot = (root, selector) => {
    if (!root) {
      return [];
    }

    const matches = root.matches?.(selector) ? [root] : [];
    return matches.concat([...(root.querySelectorAll?.(selector) || [])]);
  };

  const getRenderedRect = (element) => {
    if (element.isConnected === false) {
      return null;
    }

    if (element.closest?.('[hidden], [aria-hidden="true" i], [inert]')) {
      return null;
    }

    if (
      typeof element.checkVisibility === "function"
      && !element.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      })
    ) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const style = window.getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") {
      return null;
    }

    return rect;
  };

  const getVisibleRect = (element) => {
    const rect = getRenderedRect(element);
    if (!rect
        || rect.bottom <= 0
        || rect.right <= 0
        || rect.top >= window.innerHeight
        || rect.left >= window.innerWidth) {
      return null;
    }

    return rect;
  };

  Object.assign(cvFit.dom, { getRenderedRect, getVisibleRect, queryIncludingRoot });
})();
