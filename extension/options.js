const $ = (id) => document.getElementById(id);
let current = null; let busy = false; let saving = false; let modelsLoaded = false;
const request = async (action, body) => {
  const result = await chrome.runtime.sendMessage({ type: "BLOCKER_REQUEST", action, body });
  if (!result?.ok) throw new Error(result?.error || "Local checker unavailable");
  return result;
};
const feedback = (text) => { $("feedback").textContent = text; };
const option = (value, label) => { const element = document.createElement("option"); element.value = value; element.textContent = label; return element; };
const renderFallbacks = () => {
  const accounts = current.session.fallbackIds.map((id) => current.session.profiles.find((p) => p.id === id));
  const lines = accounts.map((account, index) => {
    const row = document.createElement("p");
    const label = document.createElement("strong");
    label.textContent = `Fallback${accounts.length > 1 ? ` ${index + 1}` : ""}${$("accountFallback").checked ? "" : " (off)"}: `;
    row.append(label, account.email || account.label);
    return row;
  });
  $("fallbackStatus").replaceChildren(...(lines.length ? lines : ["No fallback connected. Add another account."]));
};
const updateSave = () => {
  const button = $("save");
  if (!current || !modelsLoaded) { button.textContent = "Loading settings…"; button.disabled = true; return; }
  const changed = $("enabled").checked !== current.settings.enabled
    || $("accountFallback").checked !== current.settings.accountFallback
    || ($("model").value || null) !== current.settings.model;
  const resume = Boolean(current.pausedReason && $("enabled").checked);
  button.textContent = saving ? "Saving…" : changed ? (resume ? "Save and resume checks" : "Save settings") : resume ? "Resume checks" : "Saved";
  button.disabled = busy || (!changed && !resume);
};
const render = (state) => {
  current = state;
  $("connection").textContent = state.session.pending ? "Finish signing in in your browser."
    : state.session.sharing ? "Connected · Using ChatGPT plan"
    : state.session.connected ? "Plan usage is off. Continue with ChatGPT to enable it." : "Connect ChatGPT to start checking.";
  $("account").replaceChildren(...state.session.profiles.map((p) => option(p.id, p.label)));
  $("account").value = state.session.activeId || "";
  $("enabled").checked = state.settings.enabled;
  $("accountFallback").checked = state.settings.accountFallback;
  renderFallbacks();
  if (modelsLoaded) $("model").value = state.settings.model || "";
  $("connect").disabled = state.session.pending;
  $("cancel").hidden = !state.session.pending;
  $("logout").disabled = !state.session.connected;
  $("profile").textContent = state.profile ? "Verified profile ready." : state.profileError;
  if (state.pausedReason || state.session.error) feedback(state.pausedReason || state.session.error);
  updateSave();
};
const load = async () => render(await request("status"));
const loadModels = async () => {
  if (!current?.session.sharing) { $("model").replaceChildren(option("", "Connect ChatGPT plan usage first")); modelsLoaded = true; updateSave(); return; }
  const { models } = await request("models");
  $("model").replaceChildren(option("", "Choose a model"), ...models.map((m) => option(m.slug, m.name)));
  $("model").value = current.settings.model || "";
  modelsLoaded = true; updateSave();
};
const perform = async (work) => {
  if (busy) return; busy = true; updateSave();
  try { feedback(""); await work(); } catch (error) { feedback(error.message); } finally { busy = false; updateSave(); }
};
for (const [id, work] of Object.entries({
  connect: async () => { const { authUrl } = await request("sign-in", { consent: Boolean(current?.session.connected && !current.session.sharing) }); await chrome.tabs.create({ url: authUrl }); await load(); },
  add: async () => { const { authUrl } = await request("sign-in", { newProfile: true }); await chrome.tabs.create({ url: authUrl }); await load(); },
  cancel: async () => { await request("cancel-sign-in"); await load(); },
  logout: async () => { await request("sign-out"); await load(); await loadModels(); },
  refresh: loadModels,
  save: async () => {
    saving = true; updateSave();
    const body = { enabled: $("enabled").checked, accountFallback: $("accountFallback").checked };
    if ($("model").value) body.model = $("model").value;
    const resuming = Boolean(current.pausedReason && body.enabled);
    try { render(await request("settings", body)); feedback(resuming ? "Settings saved. Checks resumed." : "Settings saved."); }
    finally { saving = false; }
  },
  clear: async () => { await request("clear-cache"); const records = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(records).filter((key) => key.startsWith("blocker-result:"))); await load(); feedback("Saved findings cleared."); },
})) $(id).addEventListener("click", () => void perform(work));
$("account").addEventListener("change", () => void perform(async () => { await request("account", { id: $("account").value }); await load(); await loadModels(); }));
for (const id of ["enabled", "model", "accountFallback"]) $(id).addEventListener("change", () => { feedback(current?.pausedReason || ""); updateSave(); });
$("accountFallback").addEventListener("change", renderFallbacks);
void perform(async () => { await load(); await loadModels(); });
setInterval(() => { if (!busy && current?.session.pending) void perform(async () => { await load(); if (!current.session.pending) await loadModels(); }); }, 2000);
