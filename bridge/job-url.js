const isIndeedHost = (host) => (
  host === "indeed.com"
  || host.endsWith(".indeed.com")
  || host === "indeed.co.uk"
  || host.endsWith(".indeed.co.uk")
);

const isLinkedInHost = (host) => host === "linkedin.com" || host.endsWith(".linkedin.com");

const normalizeIndeedJobUrl = (parsed) => {
  if (parsed.pathname !== "/viewjob") {
    return null;
  }

  const jobKey = parsed.searchParams.get("jk") || parsed.searchParams.get("vjk");
  if (!jobKey || !/^[A-Za-z0-9_-]{8,64}$/.test(jobKey)) {
    return null;
  }
  return `${parsed.origin}/viewjob?jk=${encodeURIComponent(jobKey)}`;
};

const normalizeLinkedInJobUrl = (parsed) => {
  const jobId = parsed.pathname.match(/^\/jobs\/view\/(\d+)(?:\/|$)/)?.[1];
  if (!jobId || !/^\d{6,20}$/.test(jobId)) {
    return null;
  }
  return `${parsed.origin}/jobs/view/${encodeURIComponent(jobId)}/`;
};

export const validateJobUrl = (value) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Missing URL");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http(s) URLs are allowed");
  }

  const host = parsed.hostname.toLowerCase();
  const normalizedUrl = isIndeedHost(host)
    ? normalizeIndeedJobUrl(parsed)
    : isLinkedInHost(host)
      ? normalizeLinkedInJobUrl(parsed)
      : null;

  if (!normalizedUrl) {
    throw new Error("Only Indeed and LinkedIn job URLs are allowed");
  }
  return normalizedUrl;
};
