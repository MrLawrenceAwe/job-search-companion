(() => {
  const companion = globalThis.jobSearchCompanion;
  const definitions = globalThis.jobSearchContracts.shortcuts;
  const actions = {
    submitCvFit: () => {
      submitSelectedJob();
      return true;
    },
    nextJob: () => companion.jobs.navigateJob(1),
    previousJob: () => companion.jobs.navigateJob(-1),
    hideJob: () => companion.jobs.hideCurrentJob(),
    undoJobAction: () => companion.jobs.undoLastJobAction(),
  };
  const actionsByKey = new Map(Object.entries(definitions).map(([name, key]) => [key, actions[name]]));

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
      void companion.cvFitSubmissions.submit(jobUrl);
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
    if (actionsByKey.has(key)) return key;
    const codeKey = event.code?.startsWith("Key") ? event.code.slice(3).toLowerCase() : null;
    return actionsByKey.has(codeKey) ? codeKey : null;
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

      const action = actionsByKey.get(shortcutKey(event));
      if (action?.()) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
})();
