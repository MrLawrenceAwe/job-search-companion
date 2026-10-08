(() => {
  const companion = globalThis.jobSearchCompanion;
  if (companion.platform !== "indeed") return;
  const { isRetainableResult } = globalThis.jobSearchContracts.blockers;
  const recordStore = globalThis.jobSearchBlockerRecords.createStore();
  const checks = new Map();
  let checkerState = null;
  let selection = null;
  let dwell = null;
  let scanTimer = null;
  let stateBusy = false;
  let profileHash = null;
  let lastStateAt = 0;
  const request = async (action, body, id) => {
    const response = await chrome.runtime.sendMessage({
      type: "BLOCKER_REQUEST",
      action,
      body,
      id,
    });
    if (!response?.ok) throw new Error(response?.error || "Local checker unavailable");
    return response;
  };
  const digest = async (text) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const currentRecord = () => {
    const record = selection && recordStore.get(selection.jobId);
    return isRetainableResult(record) &&
      record.descriptionHash === selection.hash &&
      record.profileHash === profileHash &&
      record.model === checkerState?.settings.model
      ? record
      : null;
  };
  const start = async (force = false) => {
    const captured = selection;
    if (
      !captured ||
      !checkerState?.settings.enabled ||
      !checkerState?.connectionStatus.planUsageEnabled ||
      (!force && document.hidden)
    )
      return;
    if (!force && (currentRecord() || checks.has(captured.signature))) return;
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
    if (stateBusy) return;
    stateBusy = true;
    try {
      const updated = await request("status");
      if (
        updated.settings.enabled !== checkerState?.settings.enabled ||
        updated.settings.model !== checkerState?.settings.model ||
        updated.profile?.hash !== profileHash ||
        updated.pausedReason !== checkerState?.pausedReason
      ) {
        selection = null;
        for (const [key, check] of checks)
          if (!["checking", "queued"].includes(check.status)) checks.delete(key);
      }
      checkerState = updated;
      profileHash = checkerState.profile?.hash;
      lastStateAt = Date.now();
    } catch (error) {
      checkerState = { error: error.message, settings: { enabled: false } };
    } finally {
      stateBusy = false;
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
      clearTimeout(dwell);
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
    const description =
      text &&
      candidates.find(
        (node) =>
          compact(node.innerText || node.textContent || "") === compact(text) &&
          companion.dom.getRenderedRect(node),
      );
    if (!description || text.length < 40 || text.length > 80_000) {
      selection = null;
      clearTimeout(dwell);
      render();
      return;
    }
    const hash = await digest(text);
    if (generation !== scanGeneration) return;
    const signature = `${jobId}:${hash}:${profileHash}:${checkerState?.settings.model}`;
    if (selection?.signature === signature) {
      render();
      return;
    }
    selection = { jobId, jobUrl, text, hash, signature };
    clearTimeout(dwell);
    render();
    if (checkerState?.settings.enabled && !document.hidden && !currentRecord())
      dwell = setTimeout(() => void start(), 1500);
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
    currentRecord,
    start,
    getContext: () => ({ selection, checkerState }),
  });
  const initialize = async () => {
    await recordStore.loadRecords();
    await refreshState();
    window.postMessage({ type: "jsc-request-initial-description-v1" }, location.origin);
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
  new MutationObserver((mutations) => {
    if (
      mutations.every(
        (m) =>
          m.target.closest?.(".jsc-blocker-panel, .jsc-blocker-badge") ||
          [...m.addedNodes, ...m.removedNodes].every(
            (n) => n.nodeType === 1 && n.matches?.(".jsc-blocker-panel, .jsc-blocker-badge"),
          ),
      )
    )
      return;
    schedule();
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["href", "data-jk", "data-vjk"],
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void refreshState().then(schedule);
    } else clearTimeout(dwell);
  });
  window.addEventListener("popstate", schedule);
  document.addEventListener("click", schedule, true);
  setInterval(() => {
    if (!document.hidden && Date.now() - lastStateAt > 15_000) void refreshState().then(schedule);
  }, 5000);
  void initialize().catch((error) => {
    checkerState = { settings: { enabled: false }, error: error.message };
    render();
  });
})();
