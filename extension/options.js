const recordStore = globalThis.jobSearchBlockerResults.createStore();
const byId = (id) => document.getElementById(id);
let settingsState = null;
let busy = false;
let saving = false;
let modelsLoaded = false;
const { request } = globalThis.jobSearchBlockerClient;
const renderInferenceSettings = () => {
  const policy = globalThis.jobSearchContracts.inferenceSettings;
  const model = byId("checkerModel").value;
  const reasoningSelectable = policy.reasoningPolicyForModel(model) === "selectable";
  byId("checkerReasoning").disabled = !reasoningSelectable;
  byId("reasoningHint").hidden = reasoningSelectable;
  byId("reasoningHint").textContent = reasoningSelectable
    ? ""
    : "Other models use their default reasoning level. Select GPT-6 Luna to choose Low or Medium.";
  byId("checkerSpeed").textContent = policy.processingTierForModel(model) === "priority"
    ? "Checker processing speed: Fast requested (priority). The delivered speed tier is unconfirmed."
    : "Checker processing speed: model default. Fast processing is requested only for GPT-6 Luna.";
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
    row.append(label, account.label);
    return row;
  });
  byId("fallbackStatus").replaceChildren(
    ...(lines.length ? lines : ["No fallback connected. Add another account."]),
  );
};
const preferenceFields = {
  enabled: ["checksEnabled", "checked"],
  accountFallback: ["accountFallback", "checked"],
  reasoningEffort: ["checkerReasoning", "value"],
  model: ["checkerModel", "value"],
  indexModel: ["indexModel", "value"],
};
const normalizePreference = (property, value) => property === "checked" ? Boolean(value) : value || null;
const readPreferences = () => Object.fromEntries(Object.entries(preferenceFields).map(([key, [id, property]]) =>
  [key, normalizePreference(property, byId(id)[property])],
));
const preferenceChanged = (key, value) =>
  value !== normalizePreference(preferenceFields[key][1], settingsState.settings[key]);
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
  const changed = Object.entries(readPreferences()).some(([key, value]) => preferenceChanged(key, value));
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
const render = (state, { preserveEdits = false } = {}) => {
  const edits = preserveEdits && settingsState
    ? Object.entries(readPreferences()).filter(([key, value]) => preferenceChanged(key, value))
    : [];
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
  for (const [key, [id, property]] of Object.entries(preferenceFields)) {
    if (!modelsLoaded && ["model", "indexModel"].includes(key)) continue;
    byId(id)[property] = state.settings[key] ?? (property === "checked" ? false : "");
  }
  for (const [key, value] of edits) {
    const [id, property] = preferenceFields[key];
    byId(id)[property] = value ?? "";
  }
  renderFallbacks();
  renderInferenceSettings();
  byId("connectChatGPT").disabled = state.connectionStatus.pending;
  byId("connectChatGPT").hidden = state.connectionStatus.planUsageEnabled && !state.connectionStatus.pending;
  byId("cancelSignIn").hidden = !state.connectionStatus.pending;
  byId("signOut").disabled = !state.connectionStatus.connected;
  byId("evidence").textContent = !state.evidence ? state.evidenceError
    : state.evidence.cvIndexStatus === "current" ? "Profile loaded. CV index is current."
      : state.evidence.cvIndexStatus === "pending" ? "Profile loaded. CV index will refresh on the next check."
        : "Profile loaded. CV indexing is not configured.";
  byId("evidence").dataset.state = !state.evidence ? "error"
    : state.evidence.cvIndexStatus === "pending" ? "pending" : "ready";
  if (state.pausedReason || state.connectionStatus.error)
    feedback(state.pausedReason || state.connectionStatus.error, "error");
  updateSave();
};
const load = async (options) => render(await request("status"), options);
const loadModels = async ({ preserveSelections = false } = {}) => {
  const selections = preserveSelections ? readPreferences() : settingsState?.settings;
  if (!settingsState?.connectionStatus.planUsageEnabled) {
    byId("checkerModel").replaceChildren(option("", "Connect ChatGPT plan usage first"));
    byId("indexModel").replaceChildren(option("", "Use checker model"));
    modelsLoaded = true;
    renderInferenceSettings();
    updateSave();
    return;
  }
  const { models } = await request("models");
  const placeholder = option("", "Choose a model");
  placeholder.disabled = true;
  byId("checkerModel").replaceChildren(
    placeholder,
    ...models.map((model) => option(model.slug, model.name)),
  );
  byId("checkerModel").value = models.some((model) => model.slug === selections.model) ? selections.model : "";
  byId("indexModel").replaceChildren(option("", "Use checker model"), ...models.map((model) => option(model.slug, model.name)));
  byId("indexModel").value = models.some((model) => model.slug === selections.indexModel) ? selections.indexModel : "";
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
  refreshModels: () => loadModels({ preserveSelections: true }),
  saveSettings: async () => {
    const body = readPreferences();
    if (body.model === null && settingsState.connectionStatus.planUsageEnabled) {
      throw new Error("Choose an available checker model before saving.");
    }
    // Disconnected accounts have no catalogue or checker model to save.
    if (!settingsState.connectionStatus.planUsageEnabled) delete body.model;
    const resuming = Boolean(settingsState.pausedReason && body.enabled);
    saving = true;
    updateSave();
    try {
      render(await request("settings", body));
      feedback(resuming ? "Settings saved. Checks resumed." : "Settings saved.");
    } finally {
      saving = false;
    }
  },
  clearSavedChecks: async () => {
    await request("clear-cache");
    await recordStore.clear();
    await load();
    feedback("Saved blocker checks cleared.");
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
for (const [id] of Object.values(preferenceFields))
  byId(id).addEventListener("change", () => {
    feedback(settingsState?.pausedReason || "", "error");
    updateSave();
  });
byId("checkerModel").addEventListener("change", renderInferenceSettings);
byId("accountFallback").addEventListener("change", renderFallbacks);
void perform(async () => {
  await recordStore.ready;
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

// Returning from a job tab must expose pauses without discarding draft preferences.
const refreshOnReturn = () => {
  if (!document.hidden && !busy && settingsState)
    void perform(() => load({ preserveEdits: true }));
};
window.addEventListener("focus", refreshOnReturn);
document.addEventListener("visibilitychange", refreshOnReturn);
