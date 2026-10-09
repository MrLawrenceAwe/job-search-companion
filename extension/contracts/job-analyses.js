(() => {
  const threadIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const verdicts = Object.freeze([
    "use as-is", "edit the CV", "tailor into a role-specific CV", "create a new CV",
    "no suitable base CV", "not enough information", "do not apply yet",
  ]);
  const colorFor = (verdict) => ({
    "use as-is": "green", "edit the CV": "yellow", "do not apply yet": "red",
  }[verdict] || "blue");
  const keyFor = (jobUrl) => {
    const url = new URL(jobUrl);
    const urls = globalThis.jobSearchContracts.jobUrls;
    const linkedin = urls.isLinkedInHost(url.hostname);
    const id = linkedin ? url.pathname.match(/^\/jobs\/view\/(\d+)\/?$/)?.[1]
      : url.searchParams.get("jk") || url.searchParams.get("vjk");
    if (url.protocol !== "https:" || (!linkedin && !urls.isIndeedHost(url.hostname))
      || !(linkedin ? urls.linkedInJobIdPattern : urls.indeedJobKeyPattern).test(id || "")) {
      throw new Error("Couldn’t identify this job.");
    }
    return `analyzed-job:${linkedin ? "linkedin" : "indeed"}:${id}`;
  };
  const isRecord = (record) => Boolean(record && threadIdPattern.test(record.threadId)
    && typeof record.analyzedAt === "string" && Number.isFinite(Date.parse(record.analyzedAt))
    && (record.verdict === undefined || verdicts.includes(record.verdict)));
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.jobAnalyses = Object.freeze({
    keyFor, isRecord, verdicts, colorFor,
    isVerdict: (verdict) => verdicts.includes(verdict),
    isThreadId: (id) => typeof id === "string" && threadIdPattern.test(id),
    linkFor: (id) => {
      if (typeof id !== "string" || !threadIdPattern.test(id)) throw new Error("Invalid Codex chat ID");
      return `codex://threads/${id}?hostId=local`;
    },
  });
})();
