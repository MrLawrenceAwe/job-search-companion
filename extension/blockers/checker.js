(() => {
  const companion = globalThis.jobSearchCompanion;
  if (companion.platform !== "indeed") return;
  const { isRetainableResult, limits, canCheck } = globalThis.jobSearchContracts.blockers;
  const { reasoningForModel } = globalThis.jobSearchContracts.inferenceSettings;
  const recordStore = globalThis.jobSearchBlockerResults.createStore();
  const checks = new Map();
  const challenges = [];
  let running = false;
  const sameDescription = (left, right) => left.jobId === right.jobId && left.descriptionHash === right.descriptionHash;
  const signatureFor = (job) => `${job.jobId}:${job.descriptionHash}:${evidenceHash}:${checkerState?.settings.model}:${reasoningForModel(checkerState?.settings.model, checkerState?.settings.reasoningEffort)}`;
  let checkerState = null;
  let selection = null;
  let dwellTimer = null;
  let scanTimer = null;
  let statusRequestInProgress = false;
  let evidenceHash = null;
  let lastStatusReceivedAt = 0;
  const { request } = globalThis.jobSearchBlockerClient;
  const digest = async (text) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const getCurrentResult = () => {
    const record = selection && recordStore.get(selection.jobId);
    return isRetainableResult(record) &&
      record.descriptionHash === selection.descriptionHash &&
      record.evidenceHash === evidenceHash &&
      record.model === checkerState?.settings.model &&
      record.reasoningEffort === reasoningForModel(checkerState?.settings.model, checkerState?.settings.reasoningEffort)
      ? record
      : null;
  };
  const runCheck = async (captured, force, challenge) => {
    if (
      !captured ||
      !canCheck(checkerState) ||
      (!force && document.hidden)
    )
      return;
    checks.set(captured.signature, { status: "queued" });
    scheduleRender();
    try {
      let { check } = await request("check", {
        jobUrl: captured.jobUrl,
        description: captured.text,
        force,
        ...(challenge ? { challenge } : {}),
      });
      checks.set(captured.signature, check);
      scheduleRender();
      while (["checking", "queued"].includes(check.status)) {
        ({ check } = await request("poll", null, check.id));
        checks.set(captured.signature, check);
        // Poll completion regardless of later selection, but render only the current job.
        scheduleRender();
      }
      if (check.status === "completed") {
        await recordStore.saveResult(check.result);
        if (check.result.challengeReview?.profileUpdated) await refreshState().then(schedule);
      }
      if (check.status === "cancelled") {
        checks.delete(captured.signature);
        // A cancelled request has no result. Restart dwell only for the selected job.
        if (selection?.signature === captured.signature) schedule();
      }
      scheduleRender();
      return check;
    } catch (error) {
      checks.set(captured.signature, {
        status: "failed",
        error: error.message,
      });
      scheduleRender();
      return { status: "failed", error: error.message };
    }
  };
  const drainChallenges = async () => {
    if (running || !challenges.some((entry) => entry.status === "queued")) return;
    running = true;
    try {
      for (let entry; (entry = challenges.find((item) => item.status === "queued"));) {
        entry.status = "reviewing";
        scheduleRender();
        const captured = { ...entry.job, signature: signatureFor(entry.job) };
        const check = await runCheck(captured, true, entry.challenge);
        entry.status = check?.status || "cancelled";
        entry.error = check?.error || (check ? null : checkerState?.pausedReason || "Checking is unavailable. Submit this challenge again when checks resume.");
        scheduleRender();
      }
    } finally {
      running = false;
      schedule();
      scheduleRender();
    }
  };
  const startCheck = async (force = false, challenge) => {
    const captured = selection;
    if (!captured) return;
    if (challenge) {
      if (challenges.some((entry) => sameDescription(entry.job, captured) &&
          entry.challenge.requirementQuote === challenge.requirementQuote &&
          ["queued", "reviewing"].includes(entry.status))) return;
      // Keep only the newest submission state for this finding.
      const old = challenges.findIndex((entry) => sameDescription(entry.job, captured) &&
        entry.challenge.requirementQuote === challenge.requirementQuote);
      if (old !== -1) challenges.splice(old, 1);
      challenges.push({ job: { ...captured }, challenge: { ...challenge }, status: "queued" });
      scheduleRender();
      return drainChallenges();
    }
    if (running || (!force && (getCurrentResult() || checks.has(captured.signature)))) return;
    running = true;
    try { await runCheck(captured, force); }
    finally {
      running = false;
      if (selection && selection.signature !== captured.signature) schedule();
      void drainChallenges();
    }
  };
  const cancelDwell = () => {
    clearTimeout(dwellTimer);
    dwellTimer = null;
  };
  const scheduleDwell = () => {
    if (
      running || dwellTimer !== null || !selection || document.hidden ||
      !canCheck(checkerState) ||
      getCurrentResult() || checks.has(selection.signature)
    ) return;
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      void startCheck();
    }, 1500);
  };
  const refreshState = async () => {
    if (statusRequestInProgress) return;
    statusRequestInProgress = true;
    try {
      const updated = await request("status");
      if (
        updated.settings.enabled !== checkerState?.settings.enabled ||
        updated.settings.model !== checkerState?.settings.model ||
        updated.settings.reasoningEffort !== checkerState?.settings.reasoningEffort ||
        updated.evidence?.hash !== evidenceHash ||
        updated.pausedReason !== checkerState?.pausedReason
      ) {
        for (const [key, check] of checks)
          if (!["checking", "queued"].includes(check.status)) checks.delete(key);
      }
      checkerState = updated;
      evidenceHash = checkerState.evidence?.hash;
      if (selection) selection = { ...selection, signature: signatureFor(selection) };
      lastStatusReceivedAt = Date.now();
    } catch (error) {
      checkerState = { error: error.message, settings: { enabled: false } };
    } finally {
      statusRequestInProgress = false;
      scheduleRender();
    }
  };
  let scanGeneration = 0;
  const scan = async () => {
    const generation = ++scanGeneration;
    let jobUrl;
    try {
      jobUrl = companion.jobs.resolvePageJobUrl();
    } catch {
      selection = null;
      cancelDwell();
      scheduleRender();
      return;
    }
    const jobId = new URL(jobUrl).searchParams.get("jk");
    const text = descriptions.get(jobId);
    const compact = (value) =>
      value
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/(^|\n)\s*#{1,6}\s+/g, "$1")
        .replace(/[\s*_`]+/g, "");
    const container = document.querySelector(
      '#jobDescriptionText, [data-testid="viewjob-job-content"]',
    );
    // Indeed currently has classic and React Native detail layouts. A complete
    // embedded/response description must match an entire rendered subtree.
    const candidates = container ? [container, ...container.querySelectorAll("div, section")] : [];
    const compactDescription = text && compact(text);
    const descriptionElement =
      text &&
      candidates.find(
        (node) =>
          compact(node.innerText || node.textContent || "") === compactDescription &&
          companion.dom.getRenderedRect(node),
      );
    if (!descriptionElement || text.trim().length < limits.minimumDescriptionCharacters || text.length > limits.maximumDescriptionCharacters) {
      selection = null;
      cancelDwell();
      scheduleRender();
      return;
    }
    const descriptionHash = await digest(text);
    if (generation !== scanGeneration) return;
    const signature = signatureFor({ jobId, descriptionHash });
    if (selection?.signature !== signature) {
      cancelDwell();
      selection = { jobId, jobUrl, text, descriptionHash, signature };
    }
    scheduleRender();
    scheduleDwell();
  };
  const schedule = () => {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      void scan();
    }, 120);
  };
  const descriptions = companion.blockers.observeDescriptions(schedule);
  const scheduleRender = companion.pageDecorations.schedule;
  companion.blockers.registerRenderer({
    recordStore,
    checks,
    getCurrentResult,
    startCheck,
    getContext: () => ({ selection, checkerState, challenges: challenges.filter((entry) => selection && sameDescription(entry.job, selection)) }),
  });
  const initialize = async () => {
    await recordStore.ready;
    await refreshState();
    window.postMessage({ type: globalThis.jobSearchContracts.messages.requestInitialDescription }, location.origin);
    schedule();
  };
  recordStore.subscribe((changes) => {
    for (const { jobId, removed } of changes) {
      if (!removed) continue;
      for (const entry of challenges) {
        if (entry.job.jobId === jobId && entry.status === "queued") {
          entry.status = "cancelled";
          entry.error = "Saved results were cleared. Submit this challenge again after a new check.";
        }
      }
      for (const [signature, check] of checks)
        if (signature.startsWith(`${jobId}:`) && !["checking", "queued"].includes(check.status))
          checks.delete(signature);
      selection = null;
      schedule();
    }
    scheduleRender();
  });
  companion.pageDecorations.subscribe(schedule);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshState().then(schedule);
    } else cancelDwell();
  });
  setInterval(() => {
    if (!document.hidden && Date.now() - lastStatusReceivedAt > 15_000) void refreshState().then(schedule);
  }, 5000);
  void initialize().catch((error) => {
    checkerState = { settings: { enabled: false }, error: error.message };
    scheduleRender();
  });
})();
