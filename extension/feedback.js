(() => {
  const showToast = (message, kind = "info") => {
    document.querySelector(".jsc-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "jsc-toast";
    toast.dataset.kind = kind;
    toast.textContent = message;
    toast.setAttribute("role", kind === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4500);
  };

  globalThis.jobSearchCompanion.showToast = showToast;
})();
