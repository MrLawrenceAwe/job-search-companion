(() => {
  const cvFit = globalThis.cvFitBridge;
  if (cvFit.platform !== "indeed") return;
  const PREFIX = "blocker-result:";
  const LABELS = { clear_blocker: "Clear blocker", uncertain_requirement: "Uncertain requirement", no_blockers_found: "No blockers found" };
  const descriptions = new Map(); const records = new Map(); const checks = new Map();
  const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
  let state = null; let selection = null; let dwell = null; let scanTimer = null; let stateBusy = false;
  let profileHash = null; let lastStateAt = 0;
  const request = async (action, body, id) => {
    const response = await chrome.runtime.sendMessage({ type: "BLOCKER_REQUEST", action, body, id });
    if (!response?.ok) throw new Error(response?.error || "Local checker unavailable");
    return response;
  };
  const digest = async (text) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const keyFromUrl = (url) => { try { return new URL(url).searchParams.get("jk"); } catch { return null; } };
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
  const button = (label, click) => { const node = element("button", label); node.type = "button"; node.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); click(); }); return node; };
  const openSettings = () => chrome.runtime.sendMessage({ type: "OPEN_BLOCKER_SETTINGS" });
  const validRecord = (record) => record && record.checkerVersion === 1 && LABELS[record.outcome] && Array.isArray(record.findings) && Date.now() - Date.parse(record.checkedAt) < 30 * 86400_000;
  const currentRecord = () => {
    const record = selection && records.get(selection.jobId);
    return validRecord(record) && record.descriptionHash === selection.hash && record.profileHash === profileHash && record.model === state?.settings.model ? record : null;
  };
  const render = () => {
    for (const badge of document.querySelectorAll(".jsc-blocker-badge")) badge.remove();
    const decorated = new Set();
    for (const { element: carrier, jobUrl } of cvFit.jobs.collectJobs(cvFit.dom.getRenderedRect)) {
      const jobId = keyFromUrl(jobUrl); const record = records.get(jobId);
      const card = carrier.closest('li, [data-testid="slider_item"], .job_seen_beacon, .cardOutline');
      if (!card || decorated.has(card) || !validRecord(record)) continue;
      decorated.add(card);
      const verified = selection?.jobId === jobId && currentRecord() === record;
      const badge = element("span", `${LABELS[record.outcome]}${verified ? "" : " · Previously checked"}`, `jsc-blocker-badge jsc-${record.outcome}`);
      badge.title = `Checked ${new Date(record.checkedAt).toLocaleString()}. Open this job to verify its description against the current profile.`;
      card.append(badge);
    }
    let panel = document.querySelector(".jsc-blocker-panel");
    const heading = [...document.querySelectorAll(cvFit.selectors.jobDetailTitle)].find((node) => cvFit.dom.getRenderedRect(node));
    if (!heading) { panel?.remove(); return; }
    if (!selection) {
      if (panel?.dataset.signature === "unavailable") return;
      panel?.remove(); panel = element("section", null, "jsc-blocker-panel"); panel.dataset.signature = "unavailable";
      panel.append(element("strong", "Not checked · waiting for a full description"), element("p", "The job and its complete description must match before checking."), button("Checker settings", openSettings));
      heading.after(panel); return;
    }
    if (panel && panel.dataset.signature === `${selection.jobId}:${selection.hash}:${JSON.stringify(checks.get(selection.signature))}:${currentRecord()?.checkedAt}:${state?.settings.enabled}:${state?.pausedReason}:${state?.error}`) return;
    panel?.remove(); panel = element("section", null, "jsc-blocker-panel");
    panel.dataset.signature = `${selection.jobId}:${selection.hash}:${JSON.stringify(checks.get(selection.signature))}:${currentRecord()?.checkedAt}:${state?.settings.enabled}:${state?.pausedReason}:${state?.error}`;
    panel.setAttribute("aria-label", "Job Search Companion blocker check");
    const result = currentRecord(); const check = checks.get(selection.signature);
    let label = result ? LABELS[result.outcome] : check?.status === "checking" ? "Checking requirements…" : check?.status === "queued" ? "Waiting to check…" : check?.error || state?.pausedReason || state?.error || (!state?.settings.enabled ? "Blocker checks paused" : "Not checked yet");
    panel.append(element("strong", label));
    if (result) {
      panel.append(element("p", `Checked ${new Date(result.checkedAt).toLocaleString()} against verified profile ${result.profileHash.slice(0, 10)}.`));
      if (!result.findings.length) panel.append(element("p", "No blockers found in this description against your current profile. This check does not establish overall fit."));
      for (const finding of result.findings) {
        const details = element("details"); details.append(element("summary", `${finding.kind === "clear_blocker" ? "Clear blocker" : "Uncertain requirement"}: ${finding.explanation}`));
        details.append(element("blockquote", finding.requirementQuote));
        for (const fact of finding.profileFacts || []) details.append(element("p", `${fact.source}: ${fact.text}`));
        if (!finding.profileFacts?.length) details.append(element("p", "Your verified profile does not establish this requirement."));
        panel.append(details);
      }
    }
    const controls = element("div", null, "jsc-blocker-controls");
    const checkButton = button(result ? "Recheck" : "Check now", () => void start(true));
    checkButton.disabled = !state?.settings.enabled || !state?.session.sharing || ["checking", "queued"].includes(check?.status);
    controls.append(checkButton, button("Settings / pause", openSettings)); panel.append(controls);
    heading.after(panel);
  };
  const saveResult = async (result) => {
    records.set(result.jobId, result); await chrome.storage.local.set({ [`${PREFIX}${result.jobId}`]: result });
    const expired = [...records].filter(([, r]) => !validRecord(r)).map(([id]) => id);
    const surplus = [...records].sort((a, b) => Date.parse(b[1].checkedAt) - Date.parse(a[1].checkedAt)).slice(300).map(([id]) => id);
    const remove = [...new Set([...expired, ...surplus])];
    for (const id of remove) records.delete(id);
    if (remove.length) await chrome.storage.local.remove(remove.map((id) => PREFIX + id));
  };
  const start = async (force = false) => {
    const captured = selection;
    if (!captured || !state?.settings.enabled || !state?.session.sharing || (!force && document.hidden)) return;
    if (!force && (currentRecord() || checks.has(captured.signature))) return;
    checks.set(captured.signature, { status: "queued" }); render();
    try {
      let { check } = await request("check", { jobUrl: captured.jobUrl, description: captured.text, force });
      checks.set(captured.signature, check); render();
      while (["checking", "queued"].includes(check.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        ({ check } = await request("poll", null, check.id)); checks.set(captured.signature, check);
        // Poll completion regardless of later selection, but render only the current job.
        render();
      }
      if (check.status === "completed") await saveResult(check.result);
      render();
    } catch (error) { checks.set(captured.signature, { status: "failed", error: error.message }); render(); }
  };
  const refreshState = async () => {
    if (stateBusy) return;
    stateBusy = true;
    try {
      const updated = await request("status");
      if (updated.settings.enabled !== state?.settings.enabled || updated.settings.model !== state?.settings.model || updated.profile?.hash !== profileHash || updated.pausedReason !== state?.pausedReason) {
        selection = null;
        for (const [key, check] of checks) if (!["checking", "queued"].includes(check.status)) checks.delete(key);
      }
      state = updated; profileHash = state.profile?.hash; lastStateAt = Date.now();
    }
    catch (error) { state = { error: error.message, settings: { enabled: false } }; }
    finally { stateBusy = false; render(); }
  };
  let scanGeneration = 0;
  const scan = async () => {
    const generation = ++scanGeneration;
    let jobUrl;
    try { jobUrl = cvFit.jobs.resolveSelectedJobUrl(); } catch { selection = null; clearTimeout(dwell); render(); return; }
    const jobId = keyFromUrl(jobUrl); const text = descriptions.get(jobId);
    const compact = (value) => value.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/(^|\n)\s*#{1,6}\s+/g, "$1").replace(/[\s*_`]+/g, "");
    const container = document.querySelector('#jobDescriptionText, [data-testid="viewjob-job-content"]');
    // Indeed currently has classic and React Native detail layouts. A complete
    // embedded/response description must match an entire rendered subtree.
    const candidates = container ? [container, ...container.querySelectorAll("div, section")] : [];
    const description = text && candidates.find((node) => compact(node.innerText || node.textContent || "") === compact(text) && cvFit.dom.getRenderedRect(node));
    if (!description || text.length < 40 || text.length > 80_000) { selection = null; clearTimeout(dwell); render(); return; }
    const hash = await digest(text);
    if (generation !== scanGeneration) return;
    const signature = `${jobId}:${hash}:${profileHash}:${state?.settings.model}`;
    if (selection?.signature === signature) { render(); return; }
    selection = { jobId, jobUrl, text, hash, signature };
    clearTimeout(dwell); render();
    if (state?.settings.enabled && !document.hidden && !currentRecord()) dwell = setTimeout(() => void start(), 1500);
  };
  const schedule = () => { if (scanTimer !== null) return; scanTimer = setTimeout(() => { scanTimer = null; void scan(); }, 120); };
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== "jsc-indeed-description-v1") return;
    const { jobId, html, text } = event.data;
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(jobId || "")) return;
    let extracted;
    if (typeof text === "string" && text.length <= 80_000) extracted = text;
    else if (typeof html === "string" && html.length <= 160_000) {
      // Parse inertly and extract text; never insert job-provided HTML into the UI.
      const parsed = new DOMParser().parseFromString(html, "text/html");
      for (const node of parsed.querySelectorAll("script,style")) node.remove();
      for (const node of parsed.querySelectorAll("br,p,li,div,h1,h2,h3,h4")) node.append(parsed.createTextNode(" "));
      extracted = parsed.body.textContent;
    } else return;
    descriptions.set(jobId, normalize(extracted));
    if (descriptions.size > 50) descriptions.delete(descriptions.keys().next().value);
    schedule();
  });
  const initialize = async () => {
    const stored = await chrome.storage.local.get(null);
    for (const [key, value] of Object.entries(stored)) if (key.startsWith(PREFIX) && validRecord(value)) records.set(key.slice(PREFIX.length), value);
    await refreshState();
    window.postMessage({ type: "jsc-request-initial-description-v1" }, location.origin); schedule();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, { newValue }] of Object.entries(changes)) if (key.startsWith(PREFIX)) {
      if (validRecord(newValue)) records.set(key.slice(PREFIX.length), newValue); else {
        const jobId = key.slice(PREFIX.length); records.delete(jobId);
        for (const [signature, check] of checks) if (signature.startsWith(`${jobId}:`) && !["checking", "queued"].includes(check.status)) checks.delete(signature);
        selection = null; schedule();
      }
    }
    render();
  });
  new MutationObserver((mutations) => {
    if (mutations.every((m) => m.target.closest?.(".jsc-blocker-panel, .jsc-blocker-badge") || [...m.addedNodes, ...m.removedNodes].every((n) => n.nodeType === 1 && n.matches?.(".jsc-blocker-panel, .jsc-blocker-badge")))) return;
    schedule();
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href", "data-jk", "data-vjk"] });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { void refreshState().then(schedule); } else clearTimeout(dwell); });
  window.addEventListener("popstate", schedule); document.addEventListener("click", schedule, true);
  setInterval(() => { if (!document.hidden && Date.now() - lastStateAt > 15_000) void refreshState().then(schedule); }, 5000);
  void initialize().catch((error) => { state = { settings: { enabled: false }, error: error.message }; render(); });
})();
