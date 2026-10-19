// Keep persisted key values stable so existing marks and analyses remain accessible.
(() => {
  const prefixes = Object.freeze({
    analysis: "analyzed-job:",
    applied: "applied-job:",
    unsuitable: "unsuitable-job:",
    title: "job-title:",
    indeedApplied: "indeed-applied-job:",
    indeedDismissed: "indeed-dismissed-job:",
    indeedAvailability: "indeed-job-availability:",
  });
  const validIdentity = ({ platform, id }) => typeof id === "string" && (
    platform === "indeed" ? globalThis.jobSearchContracts.jobUrls.indeedJobKeyPattern.test(id)
      : platform === "linkedin" && globalThis.jobSearchContracts.jobUrls.linkedInJobIdPattern.test(id)
  );
  const forJob = (kind, identity) => {
    if (!Object.hasOwn(prefixes, kind) || !validIdentity(identity) ||
        (kind.startsWith("indeed") && identity.platform !== "indeed"))
      throw new Error("Invalid stored job identity");
    return prefixes[kind] + (kind.startsWith("indeed") ? identity.id : `${identity.platform}:${identity.id}`);
  };
  const parse = (key) => {
    if (typeof key !== "string") return null;
    for (const [kind, prefix] of Object.entries(prefixes)) {
      if (!key.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length);
      const [platform, id, extra] = kind.startsWith("indeed") ? ["indeed", suffix] : suffix.split(":");
      return extra === undefined && validIdentity({ platform, id }) ? { kind, platform, id } : null;
    }
    return null;
  };
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.jobStorageKeys = Object.freeze({
    forJob,
    parse,
    forUrl(kind, jobUrl) {
      const url = new URL(jobUrl);
      const identity = globalThis.jobSearchContracts.jobUrls.identityFromUrl(url);
      if (url.protocol !== "https:" || !identity) throw new Error("Couldn’t identify this job.");
      return forJob(kind, identity);
    },
  });
})();
