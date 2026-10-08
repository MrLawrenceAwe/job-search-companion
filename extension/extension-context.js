(() => {
  const host = globalThis.location?.hostname?.toLowerCase?.() || "";
  const isLinkedIn = host === "linkedin.com" || host.endsWith(".linkedin.com");

  globalThis.jobSearchCompanion = {
    platform: isLinkedIn ? "linkedin" : "indeed",
    ui: {
      cvFitActionLabel: "Analyse with CV Fit Advisor",
      menuItemClass: "jsc-menu-item",
    },
    selectors: {
      jobCard:
        'li, [data-testid="slider_item"], .job_seen_beacon, .cardOutline, [role="button"][componentkey^="job-card-component-ref-"]',
      jobDetailTitle:
        '[data-testid="vj-job-title"], .jobsearch-JobInfoHeader-title, ' +
        ".job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title",
      jobUrlCarrier:
        'a[href*="jk="], a[href*="/viewjob"], [data-jk], [data-vjk], [data-jobkey], [id^="job_"], ' +
        'a[href*="/jobs/view/"], [componentkey^="job-card-component-ref-"]',
      menuContext:
        '[role="menu"], [role="dialog"], [aria-modal="true"], ul:has(a[href*="whatsapp" i]), [role="list"]:has(a[href*="whatsapp" i])',
    },
    jobMenuDetection: {
      textPattern: isLinkedIn
        ? /\bSend in a message\b[\s\S]*\bShare in a post\b[\s\S]*\bReport this job\b/i
        : /\bCopy link\b[\s\S]*\bEmail\b[\s\S]*(\bText message\b|\bWhatsApp\b)/i,
      retryIntervalMs: 120,
      scanWindowMs: 1800,
    },
    dom: {},
    text: {
      normalizeForMatch: (value) => (value || "").replace(/\s+/g, " ").trim().toLowerCase(),
    },
    jobs: {},
    jobMarks: {},
    blockers: {},
    jobMenu: {},
    showToast: null,
    cvFitSubmissions: {},
  };
})();
