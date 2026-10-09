(() => {
  const companion = globalThis.jobSearchCompanion;
  if (companion.platform !== "indeed") return;
  const { isRetainableResult, reasoningForModel } = globalThis.jobSearchContracts.blockers;
  const recordStore = globalThis.jobSearchBlockerResults.createStore();
  const checks = new Map();
  let checkerState = null;
  let selection = null;
  let dwellTimer = null;
  let scanTimer = null;
  let statusRequestInProgress = false;
  let profileHash = null;
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
      record.profileHash === profileHash &&
      record.model === checkerState?.settings.model &&
      record.reasoningEffort === reasoningForModel(checkerState?.settings.model, checkerState?.settings.reasoningEffort)
      ? record
      : null;
  };
  const startCheck = async (force = false) => {
    const captured = selection;
    if (
      !captured ||
      !checkerState?.settings.enabled ||
      !checkerState?.connectionStatus.planUsageEnabled ||
      (!force && document.hidden)
    )
      return;
    if (!force && (getCurrentResult() || checks.has(captured.signature))) return;
    checks.set(captured.signature, { status: "queued" });
    render();
    try {
      let { check } = await request("check", {
        jobUrl: captured.jobUrl,
        description: captured.text,
        force,
      });
      checks.set(captured.signature, check);
      render();
      while (["checking", "queued"].includes(check.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        ({ check } = await request("poll", null, check.id));
        checks.set(captured.signature, check);
        // Poll completion regardless of later selection, but render only the current job.
        render();
      }
      if (check.status === "completed") await recordStore.saveResult(check.result);
      render();
    } catch (error) {
      checks.set(captured.signature, {
        status: "failed",
        error: error.message,
      });
      render();
    }
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
        updated.profile?.hash !== profileHash ||
        updated.pausedReason !== checkerState?.pausedReason
      ) {
        selection = null;
        for (const [key, check] of checks)
          if (!["checking", "queued"].includes(check.status)) checks.delete(key);
      }
      checkerState = updated;
      profileHash = checkerState.profile?.hash;
      lastStatusReceivedAt = Date.now();
    } catch (error) {
      checkerState = { error: error.message, settings: { enabled: false } };
    } finally {
      statusRequestInProgress = false;
      render();
    }
  };
  let scanGeneration = 0;
  const scan = async () => {
    const generation = ++scanGeneration;
    let jobUrl;
    try {
      jobUrl = companion.jobs.resolveSelectedJobUrl();
    } catch {
      selection = null;
      clearTimeout(dwellTimer);
      render();
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
    if (!descriptionElement || text.length < 40 || text.length > 80_000) {
      selection = null;
      clearTimeout(dwellTimer);
      render();
      return;
    }
    const descriptionHash = await digest(text);
    if (generation !== scanGeneration) return;
    const signature = `${jobId}:${descriptionHash}:${profileHash}:${checkerState?.settings.model}:${reasoningForModel(checkerState?.settings.model, checkerState?.settings.reasoningEffort)}`;
    if (selection?.signature === signature) {
      render();
      return;
    }
    selection = { jobId, jobUrl, text, descriptionHash, signature };
    clearTimeout(dwellTimer);
    render();
    if (checkerState?.settings.enabled && !document.hidden && !getCurrentResult())
      dwellTimer = setTimeout(() => void startCheck(), 1500);
  };
  const schedule = () => {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      void scan();
    }, 120);
  };
  const descriptions = companion.blockers.observeDescriptions(schedule);
  const render = companion.blockers.createRenderer({
    recordStore,
    checks,
    getCurrentResult,
    startCheck,
    getContext: () => ({ selection, checkerState }),
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
      for (const [signature, check] of checks)
        if (signature.startsWith(`${jobId}:`) && !["checking", "queued"].includes(check.status))
          checks.delete(signature);
      selection = null;
      schedule();
    }
    render();
  });
  companion.pageDecorations.subscribe(schedule);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshState().then(schedule);
    } else clearTimeout(dwellTimer);
  });
  setInterval(() => {
    if (!document.hidden && Date.now() - lastStatusReceivedAt > 15_000) void refreshState().then(schedule);
  }, 5000);
  void initialize().catch((error) => {
    checkerState = { settings: { enabled: false }, error: error.message };
    render();
  });
})();
