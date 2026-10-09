import { jobUrlContract } from "../shared/contracts.js";

const { identityFromUrl, indeedJobUrl, linkedInJobUrl } = jobUrlContract;

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

  const identity = identityFromUrl(parsed);
  if (!identity || (identity.platform === "indeed" && parsed.pathname !== "/viewjob")) {
    throw new Error("Only Indeed and LinkedIn job URLs are allowed");
  }
  return identity.platform === "indeed"
    ? indeedJobUrl(parsed.origin, identity.id)
    : linkedInJobUrl(parsed.origin, identity.id);
};
