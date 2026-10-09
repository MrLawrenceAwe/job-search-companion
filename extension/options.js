const recordStore = globalThis.jobSearchBlockerResults.createStore();
const byId = (id) => document.getElementById(id);
let settingsState = null;
let busy = false;
let saving = false;
let modelsLoaded = false;
const { request } = globalThis.jobSearchBlockerClient;
const renderInferenceSettings = () => {
  const supportsReasoningSelection = byId("checkerModel").value === "gpt-6-luna";
  byId("checkerReasoning").disabled = !supportsReasoningSelection;
  byId("reasoningHint").hidden = supportsReasoningSelection;
  byId("reasoningHint").textContent = supportsReasoningSelection
    ? ""
    : "Other models use their default reasoning level. Select GPT-6 Luna to choose Light or Medium.";
  byId("checkerSpeed").textContent = supportsReasoningSelection
    ? "Processing speed: Fast requested (priority). The delivered speed tier is unconfirmed."
    : "Processing speed: model default. Fast processing is requested only for GPT-6 Luna.";
};
const feedback = (text, state = "success") => {
  byId("feedback").textContent = text;
  byId("feedback").dataset.state = state;
};
const option = (value, label) => {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
};
const renderFallbacks = () => {
  const accounts = settingsState.connectionStatus.fallbackIds.map((id) =>
    settingsState.connectionStatus.accounts.find((account) => account.id === id),
  );
  const lines = accounts.map((account, index) => {
    const row = document.createElement("p");
    const label = document.createElement("strong");
    label.textContent = `Fallback${accounts.length > 1 ? ` ${index + 1}` : ""}${byId("accountFallback").checked ? "" : " (off)"}: `;
    row.append(label, account.email || account.label);
    return row;
  });
  byId("fallbackStatus").replaceChildren(
    ...(lines.length ? lines : ["No fallback connected. Add another account."]),
  );
};
const updateSave = () => {
  const button = byId("saveSettings");
  if (!settingsState || !modelsLoaded) {
    const failed = byId("feedback").dataset.state === "error" && byId("feedback").textContent;
    button.textContent = failed ? "Settings unavailable" : "Loading settings…";
    byId("saveHint").textContent = failed
      ? "Check the local service, then reload this page to try again."
      : "Loading your preferences…";
    button.disabled = true;
    return;
  }
  const changed =
    byId("checksEnabled").checked !== settingsState.settings.enabled ||
    byId("accountFallback").checked !== settingsState.settings.accountFallback ||
    byId("checkerReasoning").value !== settingsState.settings.reasoningEffort ||
    (byId("checkerModel").value || null) !== settingsState.settings.model ||
    (byId("indexModel").value || null) !== (settingsState.settings.indexModel || null);
  const resume = Boolean(settingsState.pausedReason && byId("checksEnabled").checked);
  byId("saveHint").textContent = saving
    ? "Saving your preferences…"
    : changed
      ? "You have unsaved changes."
      : resume
        ? "Checks are paused. Resume when you’re ready."
        : "Your preferences are up to date.";
  button.textContent = saving
    ? "Saving…"
    : changed
      ? resume
        ? "Save and resume checks"
        : "Save settings"
      : resume
        ? "Resume checks"
        : "Saved";
  button.disabled = busy || (!changed && !resume);
};
const render = (state) => {
  settingsState = state;
  byId("connection").textContent = state.connectionStatus.pending
    ? "Finish signing in in your browser."
    : state.connectionStatus.planUsageEnabled
      ? "Connected · Using ChatGPT plan"
      : state.connectionStatus.connected
        ? "Plan usage is off. Continue with ChatGPT to enable it."
        : "Connect ChatGPT to start checking.";
  byId("connectionBadge").textContent = state.connectionStatus.pending
    ? "Signing in"
    : state.connectionStatus.planUsageEnabled
      ? "Connected"
      : "Not connected";
  byId("connectionBadge").dataset.state = state.connectionStatus.pending
    ? "attention"
    : state.connectionStatus.planUsageEnabled
      ? "active"
      : "inactive";
  byId("checkingBadge").textContent = state.pausedReason
    ? "Paused"
    : state.settings.enabled
      ? "Enabled"
      : "Off";
  byId("checkingBadge").dataset.state = state.pausedReason
    ? "attention"
    : state.settings.enabled
      ? "active"
      : "inactive";
  byId("currentAccount").replaceChildren(...state.connectionStatus.accounts.map((account) => option(account.id, account.label)));
  byId("currentAccount").value = state.connectionStatus.activeId || "";
  byId("checksEnabled").checked = state.settings.enabled;
  byId("accountFallback").checked = state.settings.accountFallback;
  byId("checkerReasoning").value = state.settings.reasoningEffort;
  renderFallbacks();
  if (modelsLoaded) {
    byId("checkerModel").value = state.settings.model || "";
    byId("indexModel").value = state.settings.indexModel || "";
  }
  renderInferenceSettings();
  byId("connectChatGPT").disabled = state.connectionStatus.pending;
  byId("connectChatGPT").hidden = state.connectionStatus.planUsageEnabled && !state.connectionStatus.pending;
  byId("cancelSignIn").hidden = !state.connectionStatus.pending;
  byId("signOut").disabled = !state.connectionStatus.connected;
  byId("profile").textContent = state.profile ? "Verified profile ready." : state.profileError;
  byId("profile").dataset.state = state.profile ? "ready" : "error";
  if (state.pausedReason || state.connectionStatus.error)
    feedback(state.pausedReason || state.connectionStatus.error, "error");
  updateSave();
};
const load = async () => render(await request("status"));
const loadModels = async () => {
  if (!settingsState?.connectionStatus.planUsageEnabled) {
    byId("checkerModel").replaceChildren(option("", "Connect ChatGPT plan usage first"));
    byId("indexModel").replaceChildren(option("", "Use checker model"));
    modelsLoaded = true;
    renderInferenceSettings();
    updateSave();
    return;
  }
  const { models } = await request("models");
  byId("checkerModel").replaceChildren(
    option("", "Choose a model"),
    ...models.map((model) => option(model.slug, model.name)),
  );
  byId("checkerModel").value = settingsState.settings.model || "";
  byId("indexModel").replaceChildren(option("", "Use checker model"), ...models.map((model) => option(model.slug, model.name)));
  byId("indexModel").value = settingsState.settings.indexModel || "";
  renderInferenceSettings();
  modelsLoaded = true;
  updateSave();
};
const perform = async (work) => {
  if (busy) return;
  busy = true;
  updateSave();
  try {
    feedback("");
    await work();
  } catch (error) {
    feedback(error.message, "error");
  } finally {
    busy = false;
    updateSave();
  }
};
for (const [id, work] of Object.entries({
  connectChatGPT: async () => {
    const { authUrl } = await request("sign-in", {
      consent: Boolean(settingsState?.connectionStatus.connected && !settingsState.connectionStatus.planUsageEnabled),
    });
    await chrome.tabs.create({ url: authUrl });
    await load();
  },
  addAccount: async () => {
    const { authUrl } = await request("sign-in", { newAccount: true });
    await chrome.tabs.create({ url: authUrl });
    await load();
  },
  cancelSignIn: async () => {
    await request("cancel-sign-in");
    await load();
  },
  signOut: async () => {
    await request("sign-out");
    await load();
    await loadModels();
  },
  refreshModels: loadModels,
  saveSettings: async () => {
    saving = true;
    updateSave();
    const body = {
      enabled: byId("checksEnabled").checked,
      accountFallback: byId("accountFallback").checked,
      reasoningEffort: byId("checkerReasoning").value,
      indexModel: byId("indexModel").value || null,
    };
    if (byId("checkerModel").value) body.model = byId("checkerModel").value;
    const resuming = Boolean(settingsState.pausedReason && body.enabled);
    try {
      render(await request("settings", body));
      feedback(resuming ? "Settings saved. Checks resumed." : "Settings saved.");
    } finally {
      saving = false;
    }
  },
  clearFindings: async () => {
    await request("clear-cache");
    await recordStore.clear();
    await load();
    feedback("Saved findings cleared.");
  },
}))
  byId(id).addEventListener("click", () => void perform(work));
byId("currentAccount").addEventListener(
  "change",
  () =>
    void perform(async () => {
      await request("account", { id: byId("currentAccount").value });
      await load();
      await loadModels();
    }),
);
for (const id of ["checksEnabled", "checkerModel", "indexModel", "checkerReasoning", "accountFallback"])
  byId(id).addEventListener("change", () => {
    feedback(settingsState?.pausedReason || "", "error");
    updateSave();
  });
byId("checkerModel").addEventListener("change", renderInferenceSettings);
byId("accountFallback").addEventListener("change", renderFallbacks);
void perform(async () => {
  await load();
  await loadModels();
});
setInterval(() => {
  if (!busy && settingsState?.connectionStatus.pending)
    void perform(async () => {
      await load();
      if (!settingsState.connectionStatus.pending) await loadModels();
    });
}, 2000);
