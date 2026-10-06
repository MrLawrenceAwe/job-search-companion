(() => {
  const cvFit = globalThis.cvFitBridge;

  const MAX_TOTAL_JOB_KEY_CANDIDATES = 120;
  const MAX_SCRIPT_LENGTH = 2_000_000;
  const MAX_TOTAL_SCRIPT_LENGTH = 4_000_000;
  const TITLE_CONTEXT_CHARS = 5000;

  const decodePageText = (text) => {
    return text
      .replace(/\\u002[fF]/g, "/")
      .replace(/\\u0026/g, "&")
      .replace(/\\u003[cC]/g, "<")
      .replace(/\\u003[eE]/g, ">")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2[fF];/g, "/")
      .replace(/&amp;/g, "&");
  };

  const jobKeysNearTitle = function* (text, normalizedTitle, budget) {
    const keyPatterns = [
      /[?&](?:jk|vjk)=([A-Za-z0-9_-]{8,64})/g,
      /(?:^|[,{]|\s|["'\\])(?:jobkey|jobKey|jk|vjk)(?:["'\\])?\s*[:=]\s*(?:["'\\])([A-Za-z0-9_-]{8,64})(?:["'\\])?/g,
    ];

    for (const pattern of keyPatterns) {
      for (const match of text.matchAll(pattern)) {
        const jobKey = match[1];
        if (!cvFit.jobs.jobKeyPattern.test(jobKey)) {
          continue;
        }

        if (budget.remainingCandidates <= 0) {
          budget.truncated = true;
          return;
        }
        budget.remainingCandidates -= 1;

        const start = Math.max(0, match.index - TITLE_CONTEXT_CHARS);
        const end = Math.min(text.length, match.index + TITLE_CONTEXT_CHARS);
        if (cvFit.text.normalizeForMatch(decodePageText(text.slice(start, end))).includes(normalizedTitle)) {
          yield jobKey;
        }
      }
    }
  };

  const resolveScriptJobByTitle = (title) => {
    const normalizedTitle = cvFit.text.normalizeForMatch(title);
    if (!normalizedTitle) {
      return { status: "not-found", jobUrl: null };
    }

    const matchingJobUrls = new Set();
    let scannedScriptLength = 0;
    let scanComplete = true;
    const budget = {
      remainingCandidates: MAX_TOTAL_JOB_KEY_CANDIDATES,
      truncated: false,
    };
    for (const script of document.scripts) {
      const text = script.textContent || "";
      if (!text) {
        continue;
      }
      if (text.length > MAX_SCRIPT_LENGTH) {
        scanComplete = false;
        continue;
      }
      if (scannedScriptLength + text.length > MAX_TOTAL_SCRIPT_LENGTH) {
        scanComplete = false;
        break;
      }
      scannedScriptLength += text.length;

      for (const jobKey of jobKeysNearTitle(text, normalizedTitle, budget)) {
        matchingJobUrls.add(cvFit.jobs.jobUrlFromKey(jobKey));
        if (matchingJobUrls.size > 1) {
          return { status: "ambiguous", jobUrl: null };
        }
      }
      if (budget.truncated) {
        scanComplete = false;
        break;
      }
    }

    if (!scanComplete) {
      return { status: "incomplete", jobUrl: null };
    }
    const jobUrl = matchingJobUrls.size === 1 ? [...matchingJobUrls][0] : null;
    return { status: jobUrl ? "resolved" : "not-found", jobUrl };
  };

  const JOB_ATTRIBUTE_NAMES = [
    "href",
    "data-href",
    "data-url",
    "data-clipboard-text",
    "data-clipboard",
    "data-jk",
    "data-vjk",
    "data-jobkey",
    "id",
    "value",
    "content",
    "componentkey",
  ];
  const MAX_ATTRIBUTE_ELEMENTS = 200;
  const MAX_TITLE_LENGTH = 160;
  const cleanJobTitle = (title) => {
    return (title || "").replace(/\s*-\s*job post\s*$/i, "").trim();
  };

  const ancestorsOf = function* (sourceElement, maxDepth) {
    let element = sourceElement;
    for (let depth = 0; element && depth < maxDepth; depth += 1, element = element.parentElement) {
      if (element === document.body || element === document.documentElement) {
        return;
      }
      yield element;
    }
  };

  const extractUrlFromAttribute = (element, attributeName) => {
    const value = element.getAttribute?.(attributeName);
    if (!value) {
      return null;
    }

    if (/^(data-)?v?jk$|^data-jobkey$/i.test(attributeName) && cvFit.jobs.jobKeyPattern.test(value)) {
      return cvFit.jobs.jobUrlFromKey(value);
    }

    if (/^id$/i.test(attributeName)) {
      const jobKey = value.match(/^job_([A-Za-z0-9_-]+)$/)?.[1];
      if (jobKey && cvFit.jobs.jobKeyPattern.test(jobKey)) {
        return cvFit.jobs.jobUrlFromKey(jobKey);
      }
    }

    return cvFit.jobs.extractJobUrl(value);
  };

  const scanJobUrlsInSubtree = (root) => {
    if (!root) {
      return { jobUrls: [], complete: true };
    }

    const attributeSelector = JOB_ATTRIBUTE_NAMES.map((name) => `[${name}]`).join(",");
    const jobUrls = new Set();
    const stack = [root];
    let matchingElementCount = 0;
    while (stack.length > 0) {
      const element = stack.pop();
      if (element.matches?.(attributeSelector)) {
        matchingElementCount += 1;
        if (matchingElementCount > MAX_ATTRIBUTE_ELEMENTS) {
          return { jobUrls: [...jobUrls], complete: false };
        }
        for (const attributeName of JOB_ATTRIBUTE_NAMES) {
          const jobUrl = extractUrlFromAttribute(element, attributeName);
          if (jobUrl) {
            jobUrls.add(jobUrl);
          }
        }
      }
      const childElements = element.children || [];
      for (let index = childElements.length - 1; index >= 0; index -= 1) {
        stack.push(childElements[index]);
      }
    }
    return { jobUrls: [...jobUrls], complete: true };
  };

  const findUniqueJobUrlInSubtree = (root) => {
    const urlScan = scanJobUrlsInSubtree(root);
    return urlScan.complete && urlScan.jobUrls.length === 1
      ? urlScan.jobUrls[0]
      : null;
  };

  const readHeading = (element) => {
    const heading = element?.matches?.("h1, h2, h3") ? element : element?.querySelector?.("h1, h2, h3");
    return cleanJobTitle(heading?.textContent);
  };

  const findJobTitleNear = (sourceElement) => {
    for (const element of ancestorsOf(sourceElement, 8)) {
      const rect = cvFit.dom.getVisibleRect(element);
      if (!rect || rect.width > 1000 || rect.height > 420 || element.childElementCount > 120) {
        continue;
      }

      const title = readHeading(element);
      if (title) {
        return title;
      }
    }
    return null;
  };

  const collectJobs = (getRect) => {
    const jobEntries = [];
    for (const element of document.querySelectorAll(cvFit.selectors.jobUrlCarrier)) {
      if (!getRect(element)) {
        continue;
      }
      const jobUrl = findUniqueJobUrlInSubtree(element);
      if (jobUrl) {
        jobEntries.push({ element, jobUrl });
      }
    }
    return jobEntries;
  };

  const collectVisibleJobs = () => collectJobs(cvFit.dom.getVisibleRect);

  const candidateTitles = (carrier) => {
    const titles = [carrier.textContent, carrier.getAttribute("aria-label"), carrier.title];
    for (const element of ancestorsOf(carrier.parentElement, 7)) {
      const rect = cvFit.dom.getVisibleRect(element);
      if (!rect || rect.width > 720 || rect.height > 520 || element.childElementCount > 160) {
        continue;
      }
      titles.push(readHeading(element), element.textContent);
    }
    return titles.map(cvFit.text.normalizeForMatch).filter(Boolean);
  };

  const resolveVisibleJobByTitle = (title) => {
    const normalizedTitle = cvFit.text.normalizeForMatch(title);
    if (!normalizedTitle) {
      return { status: "not-found", jobUrl: null };
    }

    const matchingJobUrls = new Set();
    for (const { element, jobUrl } of collectVisibleJobs()) {
      if (candidateTitles(element).some((candidateTitle) => candidateTitle === normalizedTitle)) {
        matchingJobUrls.add(jobUrl);
      }
    }
    if (matchingJobUrls.size > 1) {
      return { status: "ambiguous", jobUrl: null };
    }
    const jobUrl = matchingJobUrls.size === 1 ? [...matchingJobUrls][0] : null;
    return { status: jobUrl ? "resolved" : "not-found", jobUrl };
  };

  const findDetailPaneJobTitle = () => {
    const headings = [...document.querySelectorAll('h1, h2, [data-testid*="title" i]')];
    const rightPaneHeadings = headings
      .map((heading) => ({ heading, rect: cvFit.dom.getVisibleRect(heading) }))
      .filter(({ rect }) => rect && rect.left > window.innerWidth * 0.35)
      .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);

    for (const { heading } of rightPaneHeadings) {
      const title = cleanJobTitle(heading.textContent);
      if (title && title.length <= MAX_TITLE_LENGTH) {
        return title;
      }
    }
    return null;
  };

  const findJobUrlInMenu = (sourceElement) => {
    return findUniqueJobUrlInSubtree(sourceElement?.closest?.(cvFit.selectors.menuContext));
  };

  const scanJobUrlsNear = (sourceElement) => {
    for (const element of ancestorsOf(sourceElement, 8)) {
      const rect = cvFit.dom.getVisibleRect(element);
      if (!rect || rect.width > 1000 || rect.height > 1200 || element.childElementCount > MAX_ATTRIBUTE_ELEMENTS) {
        continue;
      }

      const urlScan = scanJobUrlsInSubtree(element);
      if (urlScan.jobUrls.length > 0 || !urlScan.complete) {
        return urlScan;
      }
    }
    return { jobUrls: [], complete: true };
  };

  let pendingShareContext = null;

  const captureShareContext = (shareButton) => {
    pendingShareContext = {
      nearbyUrlScan: scanJobUrlsNear(shareButton),
      title: findJobTitleNear(shareButton) || findDetailPaneJobTitle(),
      currentJobUrl: cvFit.platform === "linkedin"
        ? cvFit.jobs.jobUrlFromLinkedInPageUrl(window.location.href)
        : null,
    };
  };

  const resolveJobUrlByTitle = (title) => {
    const visibleMatch = resolveVisibleJobByTitle(title);
    if (visibleMatch.status === "ambiguous") {
      return null;
    }
    const scriptMatch = resolveScriptJobByTitle(title);
    if (visibleMatch.status === "resolved") {
      if (scriptMatch.status === "resolved"
          && scriptMatch.jobUrl !== visibleMatch.jobUrl) {
        return null;
      }
      return visibleMatch.jobUrl;
    }
    return scriptMatch.status === "resolved" ? scriptMatch.jobUrl : null;
  };

  const resolveCurrentJobUrl = () => {
    const pageJobUrl = cvFit.jobs.jobUrlFromPageUrl(window.location.href);
    if (pageJobUrl) {
      return pageJobUrl;
    }

    const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href;
    const canonicalJobUrl = canonicalUrl && cvFit.jobs.jobUrlFromPageUrl(canonicalUrl);
    if (canonicalJobUrl) {
      return canonicalJobUrl;
    }

    const jobTitle = findDetailPaneJobTitle();
    const titleJobUrl = resolveJobUrlByTitle(jobTitle);
    if (titleJobUrl) {
      return titleJobUrl;
    }

    throw new Error("No supported job URL found");
  };

  const resolveJobUrl = (sourceElement) => {
    const menuJobUrl = findJobUrlInMenu(sourceElement);
    if (menuJobUrl) {
      pendingShareContext = null;
      return menuJobUrl;
    }

    const shareContext = pendingShareContext;
    pendingShareContext = null;
    if (!shareContext) {
      return resolveCurrentJobUrl();
    }

    if (shareContext.currentJobUrl) {
      return shareContext.currentJobUrl;
    }

    const { jobUrls: nearbyJobUrls, complete: nearbyScanComplete } =
      shareContext.nearbyUrlScan;
    const capturedTitleJobUrl = shareContext.title
      ? resolveJobUrlByTitle(shareContext.title)
      : null;
    if (nearbyScanComplete && nearbyJobUrls.length === 1) {
      if (capturedTitleJobUrl && capturedTitleJobUrl !== nearbyJobUrls[0]) {
        throw new Error("The shared job could not be identified safely");
      }
      return nearbyJobUrls[0];
    }
    if (capturedTitleJobUrl && nearbyJobUrls.includes(capturedTitleJobUrl)) {
      return capturedTitleJobUrl;
    }
    if (!nearbyScanComplete || nearbyJobUrls.length > 1) {
      throw new Error("The shared job could not be identified safely");
    }
    if (capturedTitleJobUrl) {
      return capturedTitleJobUrl;
    }
    throw new Error("The shared job could not be identified safely");
  };

  Object.assign(cvFit.jobs, {
    captureShareContext,
    collectJobs,
    resolveCurrentJobUrl,
    resolveJobUrl,
  });
})();
