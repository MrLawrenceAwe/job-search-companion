(() => {
  const companion = globalThis.jobSearchCompanion;
  const {
    indeedJobKeyPattern,
    linkedInJobIdPattern: LINKEDIN_JOB_ID_PATTERN,
    isIndeedHost,
    isLinkedInHost,
    indeedJobUrl,
    linkedInJobUrl,
    identityFromUrl,
  } = globalThis.jobSearchContracts.jobUrls;

  const indeedJobUrlFromKey = (jobKey) => {
    return indeedJobUrl(window.location.origin, jobKey);
  };

  const linkedInJobUrlFromId = (jobId) => {
    return linkedInJobUrl(window.location.origin, jobId);
  };

  const jobUrlFromIndeedPageUrl = (rawUrl) => {
    try {
      const parsed = new URL(rawUrl, window.location.href);
      const host = parsed.hostname.toLowerCase();
      const isJobPage = parsed.pathname === "/viewjob";
      const isResultsContext =
        ["/", "/jobs"].includes(parsed.pathname) && parsed.searchParams.has("vjk");
      if (!isIndeedHost(host) || (!isJobPage && !isResultsContext)) {
        return null;
      }

      const identity = identityFromUrl(parsed);
      return identity ? indeedJobUrl(parsed.origin, identity.id) : null;
    } catch {
      return null;
    }
  };

  const jobUrlFromLinkedInPageUrl = (rawUrl) => {
    try {
      const parsed = new URL(rawUrl, window.location.href);
      if (!isLinkedInHost(parsed.hostname.toLowerCase())) {
        return null;
      }

      const jobId = identityFromUrl(parsed)?.id || parsed.searchParams.get("currentJobId");
      if (!jobId || !LINKEDIN_JOB_ID_PATTERN.test(jobId)) {
        return null;
      }
      return linkedInJobUrl(parsed.origin, jobId);
    } catch {
      return null;
    }
  };

  const jobUrlFromPageUrl = (rawUrl) =>
    jobUrlFromIndeedPageUrl(rawUrl) || jobUrlFromLinkedInPageUrl(rawUrl);

  const extractIndeedJobUrl = (text) => {
    if (!text) {
      return null;
    }

    const directUrl = text.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
    const directJobUrl = directUrl && jobUrlFromIndeedPageUrl(directUrl);
    if (directJobUrl) {
      return directJobUrl;
    }

    const relativeUrl = text.match(/\/viewjob\?[^\s"'<>]+/i)?.[0];
    const relativeJobUrl = relativeUrl && jobUrlFromIndeedPageUrl(relativeUrl);
    if (relativeJobUrl) {
      return relativeJobUrl;
    }

    const jobKey = text.match(/[?&](?:jk|vjk)=([A-Za-z0-9_-]+)/)?.[1];
    return jobKey && indeedJobKeyPattern.test(jobKey) ? indeedJobUrlFromKey(jobKey) : null;
  };

  const extractJobUrl = (text) => {
    if (!text) {
      return null;
    }

    const directUrl = text.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
    const directJobUrl = directUrl && jobUrlFromPageUrl(directUrl);
    if (directJobUrl) {
      return directJobUrl;
    }

    const linkedInPath = text.match(/\/jobs\/view\/\d+(?:\/[^\s"'<>]*)?/i)?.[0];
    const linkedInJobUrl = linkedInPath && jobUrlFromLinkedInPageUrl(linkedInPath);
    if (linkedInJobUrl) {
      return linkedInJobUrl;
    }

    const linkedInJobId = text.match(/(?:currentJobId=|job-card-component-ref-)(\d{6,20})/)?.[1];
    if (linkedInJobId) {
      return linkedInJobUrlFromId(linkedInJobId);
    }

    return extractIndeedJobUrl(text);
  };

  Object.assign(companion.jobs, {
    extractJobUrl,
    indeedJobKeyPattern,
    jobUrlFromPageUrl,
    jobUrlFromLinkedInPageUrl,
    indeedJobUrlFromKey,
  });
})();
