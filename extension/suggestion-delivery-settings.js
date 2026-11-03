(() => {
  const { enabledKey: key } = globalThis.jobSearchContracts.suggestionDeliveryPreferences;
  const toggle = document.getElementById("suggestionDeliveryEnabled");
  toggle.disabled = true;
  chrome.storage.local.get(key).then((saved) => {
    toggle.checked = saved[key] !== false;
    toggle.disabled = false;
  }).catch(() => {});
  toggle.addEventListener("change", () => {
    toggle.disabled = true;
    chrome.storage.local.set({ [key]: toggle.checked }).catch(() => {
      toggle.checked = !toggle.checked;
    }).finally(() => { toggle.disabled = false; });
  });
})();
