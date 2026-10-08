import { jobUrlContract } from "../shared/contracts.js";

const { isIndeedHost, isLinkedInHost, indeedJobKeyPattern, linkedInJobIdPattern,
  indeedJobUrl, linkedInJobUrl } = jobUrlContract;

const normalizeIndeedJobUrl = (parsed) => {
  if (parsed.pathname !== "/viewjob") {
    return null;
  }

  const jobKey = parsed.searchParams.get("jk") || parsed.searchParams.get("vjk");
  if (!jobKey || !indeedJobKeyPattern.test(jobKey)) {
    return null;
  }
  return indeedJobUrl(parsed.origin, jobKey);
};

const normalizeLinkedInJobUrl = (parsed) => {
  const jobId = parsed.pathname.match(/^\/jobs\/view\/(\d+)(?:\/|$)/)?.[1];
  if (!jobId || !linkedInJobIdPattern.test(jobId)) {
    return null;
  }
  return linkedInJobUrl(parsed.origin, jobId);
};

export const normalizeJobUrl = (value) => {
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
