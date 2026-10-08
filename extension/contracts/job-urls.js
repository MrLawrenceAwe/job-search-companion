(() => {
  const indeedJobKeyPattern = /^[A-Za-z0-9_-]{8,64}$/;
  const linkedInJobIdPattern = /^\d{6,20}$/;
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.jobUrls = Object.freeze({
    indeedJobKeyPattern,
    linkedInJobIdPattern,
    isIndeedHost: (host) => /(^|\.)indeed\.(com|co\.uk)$/.test(host),
    isLinkedInHost: (host) => host === "linkedin.com" || host.endsWith(".linkedin.com"),
    indeedJobUrl: (origin, key) => `${origin}/viewjob?jk=${encodeURIComponent(key)}`,
    linkedInJobUrl: (origin, id) => `${origin}/jobs/view/${encodeURIComponent(id)}/`,
  });
})();
