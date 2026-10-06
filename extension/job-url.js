(() => {
  const cvFit = globalThis.cvFitBridge;
  const JOB_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
  const LINKEDIN_JOB_ID_PATTERN = /^\d{6,20}$/;

  const isIndeedHost = (host) => (
    host === "indeed.com"
    || host.endsWith(".indeed.com")
    || host === "indeed.co.uk"
    || host.endsWith(".indeed.co.uk")
  );

  const isLinkedInHost = (host) => host === "linkedin.com" || host.endsWith(".linkedin.com");

  const jobUrlFromKey = (jobKey) => {
    return `${window.location.origin}/viewjob?jk=${encodeURIComponent(jobKey)}`;
  };

  const linkedInJobUrlFromId = (jobId) => {
    return `${window.location.origin}/jobs/view/${encodeURIComponent(jobId)}/`;
  };

  const jobUrlFromIndeedPageUrl = (rawUrl) => {
    try {
      const parsed = new URL(rawUrl, window.location.href);
      const host = parsed.hostname.toLowerCase();
      const isJobPage = parsed.pathname === "/viewjob";
      const isResultsContext = ["/", "/jobs"].includes(parsed.pathname)
        && parsed.searchParams.has("vjk");
      if (!isIndeedHost(host) || (!isJobPage && !isResultsContext)) {
        return null;
      }

      const jobKey = parsed.searchParams.get("jk") || parsed.searchParams.get("vjk");
      if (!jobKey || !JOB_KEY_PATTERN.test(jobKey)) {
        return null;
      }

      return `${parsed.origin}/viewjob?jk=${encodeURIComponent(jobKey)}`;
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

      const pathJobId = parsed.pathname.match(/^\/jobs\/view\/(\d+)(?:\/|$)/)?.[1];
      const jobId = pathJobId || parsed.searchParams.get("currentJobId");
      if (!jobId || !LINKEDIN_JOB_ID_PATTERN.test(jobId)) {
        return null;
      }
      return `${parsed.origin}/jobs/view/${encodeURIComponent(jobId)}/`;
    } catch {
      return null;
    }
  };

  const jobUrlFromPageUrl = (rawUrl) => (
    jobUrlFromIndeedPageUrl(rawUrl) || jobUrlFromLinkedInPageUrl(rawUrl)
  );

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
    return jobKey && JOB_KEY_PATTERN.test(jobKey) ? jobUrlFromKey(jobKey) : null;
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

  Object.assign(cvFit.jobs, {
    extractIndeedJobUrl,
    extractJobUrl,
    jobKeyPattern: JOB_KEY_PATTERN,
    jobUrlFromPageUrl,
    jobUrlFromIndeedPageUrl,
    jobUrlFromLinkedInPageUrl,
    jobUrlFromKey,
    linkedInJobUrlFromId,
  });
})();
