(() => {
  const companion = globalThis.jobSearchCompanion;
  const supportedShortcutKeys = new Set(["n", "j", "k", "h", "u"]);

  const isEditableTarget = (target) => {
    if (!(target instanceof Element)) {
      return false;
    }

    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
      ),
    );
  };

  const submitSelectedJob = () => {
    try {
      const jobUrl = companion.jobs.resolveSelectedJobUrl();
      void companion.submissions.submit(jobUrl);
    } catch (error) {
      console.debug("CV Fit keyboard shortcut job resolution failed:", error);
      companion.showToast("Couldn’t identify the current job.", "error");
    }
  };

  const shortcutKey = (event) => {
    if (event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) {
      return null;
    }

    const key = event.key?.toLowerCase();
    if (supportedShortcutKeys.has(key)) {
      return key;
    }

    const codeKey = event.code?.match(/^Key([NJKHU])$/)?.[1].toLowerCase();
    return codeKey || null;
  };

  const shortcutActionFor = (event) => {
    switch (shortcutKey(event)) {
      case "n":
        return () => {
          submitSelectedJob();
          return true;
        };
      case "j":
        return () => companion.jobs.navigateJob(1);
      case "k":
        return () => companion.jobs.navigateJob(-1);
      case "h":
        return companion.jobs.hideCurrentJob;
      case "u":
        return companion.jobs.undoLastJobAction;
      default:
        return null;
    }
  };

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const action = shortcutActionFor(event);
      if (action?.()) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
})();
