(() => {
  const enabledKey = "indeed-recommendations-enabled";
  const intervalMs = 30 * 60_000;
  const maxAgeMs = 60 * 60_000;
  const maxJobs = 30;
  const maximumSuggestions = 5;
  const isPriority = (job) => /\b(?:welwyn\s+garden\s+city|hatfield)\b/i.test(job.location)
    || (/\bremote\b/i.test(job.location) && !/\b(?:hybrid|not\s+remote|no\s+remote|non.remote)\b/i.test(job.location));
  const isFeedJob = (job) => isJob(job) && typeof job.description === "string"
    && job.description.length <= 80_000 && typeof job.descriptionComplete === "boolean";
  const isCheckedJob = (job) => isJob(job)
    && ["completed", "checking", "unavailable", "incomplete"].includes(job.blockerCheck?.status)
    && (job.blockerCheck.status !== "completed" || (
      Number.isFinite(Date.parse(job.blockerCheck.checkedAt))
      && ["blocker", "no_blockers_found"].includes(job.blockerCheck.outcome)
      && Array.isArray(job.blockerCheck.findings) && job.blockerCheck.findings.length <= 60
      && job.blockerCheck.findings.every((finding) => typeof finding.requirementQuote === "string"
        && finding.requirementQuote.length <= 2000 && typeof finding.explanation === "string"
        && finding.explanation.length <= 2000)));
  const isJob = (job) => {
    try {
      const url = new URL(job.jobUrl);
      return url.origin === "https://uk.indeed.com" && url.pathname === "/viewjob"
        && globalThis.jobSearchContracts.jobUrls.indeedJobKeyPattern.test(url.searchParams.get("jk") || "")
        && !url.username && !url.password && !url.hash && [...url.searchParams.keys()].length === 1
        && ["title", "company", "location", "pay"].every((key) => typeof job[key] === "string"
          && job[key].length <= 300 && (key !== "title" || job[key].trim().length > 0));
    } catch { return false; }
  };
  const isFresh = (batch, now = Date.now()) => batch?.status === "ready"
    && Number.isFinite(Date.parse(batch.collectedAt)) && Date.parse(batch.collectedAt) <= now
    && now - Date.parse(batch.collectedAt) < maxAgeMs
    && Array.isArray(batch.jobs) && batch.jobs.length <= maxJobs && batch.jobs.every(isJob);
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.recommendations = Object.freeze({ enabledKey, intervalMs, maxAgeMs, maxJobs, maximumSuggestions, isPriority, isJob, isFeedJob, isCheckedJob, isFresh });
})();
