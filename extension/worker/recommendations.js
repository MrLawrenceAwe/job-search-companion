(() => {
  globalThis.jobSearchWorkerModules ??= {};
  globalThis.jobSearchWorkerModules.createRecommendationService = ({ bridgeConfig, requestBridgeJson }) => {
    const contract = globalThis.jobSearchContracts.recommendations;
    const messages = globalThis.jobSearchContracts.messages;
    const stateKey = "indeed-suggestion-state";
    const enabledKey = "indeed-recommendations-enabled";
    let active = null;
    const trusted = (sender) => sender.id === chrome.runtime.id && sender.frameId === 0
      && Number.isInteger(sender.tab?.id) && /^https?:\/\//.test(sender.url || "");
    const readCheck = async (job) => {
      try {
        const key = new URL(job.jobUrl).searchParams.get("jk");
        const { response, body } = await requestBridgeJson(`${bridgeConfig.bridgeOrigin}/suggestions/${key}/check`, { method: "GET" });
        const checked = body?.jobs?.find((item) => item.jobUrl === job.jobUrl);
        if (response.ok && body.ok && contract.isCheckedJob(checked)) return checked;
      } catch { /* Surface an unavailable check on the card, not a background error. */ }
      return { ...job, blockerCheck: { status: "unavailable" } };
    };
    const poll = (sender) => {
      if (active || actionInFlight) return Promise.resolve({ ok: true });
      active = (async () => {
        if (!bridgeConfig.bridgeToken) return { ok: true };
        const saved = await chrome.storage.local.get([stateKey, enabledKey]);
        if (saved[enabledKey] === false) return { ok: true };
        const now = Date.now();
        const state = saved[stateKey] || {};
        if (Number.isFinite(state.snoozedUntil) && now < state.snoozedUntil) return { ok: true };
        if (now - (state.lastSuggestedAt || 0) < contract.intervalMs) return { ok: true };
        const { response, body } = await requestBridgeJson(`${bridgeConfig.bridgeOrigin}/suggestions`, { method: "GET" });
        if (!response.ok || body?.ok !== true || !contract.isFresh(body, now)) return { ok: true };
        const history = Object.fromEntries(Object.entries(state.history || {})
          .filter(([, at]) => Number.isFinite(at) && now - at < 30 * 86400_000));
        const eligible = [];
        const ordered = [...body.jobs].sort((left, right) => Number(contract.isPriority(right)) - Number(contract.isPriority(left)));
        for (const job of ordered) {
          const identity = globalThis.jobSearchContracts.jobUrls.identityFromUrl(new URL(job.jobUrl));
          const keys = ["applied", "unsuitable", "indeedApplied", "indeedDismissed"]
            .map((kind) => globalThis.jobSearchContracts.jobStorageKeys.forJob(kind, identity));
          if (history[identity.id] || Object.values(await chrome.storage.local.get(keys)).some(Boolean)) continue;
          eligible.push(job);
          if (eligible.length >= contract.maximumSuggestions) break;
        }
        const jobs = (await Promise.all(eligible.map(readCheck)))
          .filter((job) => job.blockerCheck.status !== "checking");
        if (!jobs.length) return { ok: true };
        for (const job of jobs) {
          const identity = globalThis.jobSearchContracts.jobUrls.identityFromUrl(new URL(job.jobUrl));
          history[identity.id] = now;
        }
        const bounded = Object.fromEntries(Object.entries(history).sort((a, b) => b[1] - a[1]).slice(0, 1000));
        await chrome.storage.local.set({ [stateKey]: {
          lastSuggestedAt: now, history: bounded,
          pending: { tabId: sender.tab.id, jobs, shownAt: now },
        } });
        return { ok: true, jobs };
      })().finally(() => { active = null; });
      return active;
    };
    const act = async (message, sender) => {
      if (!["open", "analyse", "unsuitable", "dismiss", "snooze"].includes(message.action)) return { ok: false };
      if (message.action === "snooze" && (!Number.isInteger(message.hours) || message.hours < 1 || message.hours > 5))
        return { ok: false };
      const saved = await chrome.storage.local.get(stateKey);
      const state = saved[stateKey];
      const pending = state?.pending;
      const job = pending?.jobs?.find((item) => item.jobUrl === message.jobUrl);
      if (pending?.tabId !== sender.tab.id || !job
        || Date.now() - pending.shownAt > 24 * 60 * 60_000) return { ok: message.action === "dismiss" };
      // Consume before effects so double-clicks cannot duplicate analysis submissions.
      const remaining = pending.jobs.filter((item) => item.jobUrl !== job.jobUrl);
      await chrome.storage.local.set({ [stateKey]: { ...state,
        pending: message.action === "snooze" || !remaining.length ? null : { ...pending, jobs: remaining },
        ...(message.action === "snooze" ? { snoozedUntil: Date.now() + message.hours * 60 * 60_000 } : {}),
      } });
      try {
        if (message.action === "open") await chrome.tabs.create({ url: job.jobUrl });
        if (message.action === "unsuitable") {
          const key = globalThis.jobSearchContracts.jobStorageKeys.forUrl("unsuitable", job.jobUrl);
          await chrome.storage.local.set({ [key]: { jobUrl: job.jobUrl, unsuitableAt: new Date().toISOString() } });
        }
        if (message.action === "analyse") {
          const { response, body } = await requestBridgeJson(`${bridgeConfig.bridgeOrigin}/cv-fit-submissions`, {
            method: "POST", body: { jobUrl: job.jobUrl },
          });
          if (!response.ok || !body?.ok) throw new Error("Could not start CV Fit Advisor. Try again.");
        }
        return { ok: true };
      } catch {
        await chrome.storage.local.set({ [stateKey]: state });
        return { ok: false, error: "Couldn’t complete that action. Please try again." };
      }
    };
    // Serialise card actions across rapid clicks without keeping a worker alive.
    let actionInFlight = null;
    const handleMessage = (message, sender, sendResponse) => {
      if (![messages.pollSuggestion, messages.actOnSuggestion].includes(message?.type)) return false;
      if (!trusted(sender)) { sendResponse({ ok: false }); return false; }
      let request;
      if (message.type === messages.pollSuggestion) request = poll(sender);
      else if (actionInFlight) request = Promise.resolve({ ok: false });
      else {
        actionInFlight = act(message, sender).finally(() => { actionInFlight = null; });
        request = actionInFlight;
      }
      request.then(sendResponse, () => sendResponse(message.type === messages.actOnSuggestion
        ? { ok: false, error: "Couldn’t complete that action. Please try again." } : { ok: true }));
      return true;
    };
    return { handleMessage };
  };
})();
