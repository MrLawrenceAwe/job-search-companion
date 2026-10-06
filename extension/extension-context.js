(() => {
  const host = globalThis.location?.hostname?.toLowerCase?.() || "";
  const isLinkedIn = host === "linkedin.com" || host.endsWith(".linkedin.com");

  globalThis.cvFitBridge = {
    platform: isLinkedIn ? "linkedin" : "indeed",
    ui: {
      actionLabel: "Analyse with CV Fit Advisor",
      menuItemClass: "cv-fit-bridge-menu-item",
      shortcut: {
        aria: "N",
        display: "N",
      },
    },
    selectors: {
      jobUrlCarrier:
        'a[href*="jk="], a[href*="/viewjob"], [data-jk], [data-vjk], [data-jobkey], [id^="job_"], '
        + 'a[href*="/jobs/view/"], [componentkey^="job-card-component-ref-"]',
      menuContext:
        '[role="menu"], [role="dialog"], [aria-modal="true"], ul:has(a[href*="whatsapp" i]), [role="list"]:has(a[href*="whatsapp" i])',
    },
    shareMenuDetection: {
      textPattern: isLinkedIn
        ? /\bSend in a message\b[\s\S]*\bShare in a post\b[\s\S]*\bReport this job\b/i
        : /\bCopy link\b[\s\S]*\bEmail\b[\s\S]*(\bText message\b|\bWhatsApp\b)/i,
      retryIntervalMs: 120,
      scanWindowMs: 1800,
    },
    protocol: {
      submitTaskMessage: "SUBMIT_CV_FIT_TASK",
      getTaskStatusMessage: "GET_CV_FIT_TASK_STATUS",
      bridgeToken: null,
      bridgeOrigin: null,
    },
    dom: {},
    text: {
      normalizeForMatch: (value) => (value || "").replace(/\s+/g, " ").trim().toLowerCase(),
    },
    jobs: {},
    jobMarks: {},
    shareMenu: {},
    showToast: null,
    submissions: {},
  };
})();
