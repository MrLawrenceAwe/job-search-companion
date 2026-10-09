(() => {
  const indeedJobKeyPattern = /^[A-Za-z0-9_-]{8,64}$/;
  const linkedInJobIdPattern = /^\d{6,20}$/;
  const isIndeedHost = (host) => /(^|\.)indeed\.(com|co\.uk)$/.test(host);
  const isLinkedInHost = (host) => host === "linkedin.com" || host.endsWith(".linkedin.com");
  const identityFromUrl = (url) => {
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const linkedin = isLinkedInHost(url.hostname);
    if (!linkedin && !isIndeedHost(url.hostname)) return null;
    const id = linkedin ? url.pathname.match(/^\/jobs\/view\/(\d+)(?:\/|$)/)?.[1]
      : url.searchParams.get("jk") || url.searchParams.get("vjk");
    if (!(linkedin ? linkedInJobIdPattern : indeedJobKeyPattern).test(id || "")) return null;
    return { platform: linkedin ? "linkedin" : "indeed", id };
  };
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.jobUrls = Object.freeze({
    indeedJobKeyPattern,
    linkedInJobIdPattern,
    isIndeedHost,
    isLinkedInHost,
    identityFromUrl,
    indeedJobUrl: (origin, key) => `${origin}/viewjob?jk=${encodeURIComponent(key)}`,
    linkedInJobUrl: (origin, id) => `${origin}/jobs/view/${encodeURIComponent(id)}/`,
  });
})();
