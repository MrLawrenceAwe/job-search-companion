(() => {
  const contract = globalThis.jobSearchContracts.jobAnalyses;
  const createRenderer = () => {
    let panel;
    let signature;
    return ({ jobs, syncState }) => {
      if (!panel?.isConnected) {
        panel = document.createElement("details");
        panel.className = "jsc-to-apply";
        panel.append(document.createElement("summary"), document.createElement("div"));
        document.body.append(panel);
        signature = null;
      }
      const next = JSON.stringify({ jobs, syncState });
      if (signature === next) return;
      signature = next;
      panel.querySelector("summary").textContent = `To apply · ${jobs.length}`;
      const content = panel.querySelector("div");
      const note = document.createElement("p");
      const list = document.createElement("ul");
      for (const job of jobs) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = job.url;
        link.textContent = job.title;
        const verdict = document.createElement("span");
        verdict.textContent = contract.labelFor(job.verdict);
        item.append(link, verdict);
        list.append(item);
      }
      if (!jobs.length) note.textContent = `No eligible unapplied jobs with a ${contract.toApplyVerdicts.map(contract.labelFor).join(" or ")} verdict.`;
      const status = document.createElement("p");
      status.setAttribute("role", "status");
      status.textContent = syncState === "checking" ? "Checking Indeed applications…"
        : syncState === "failed" ? "Couldn’t refresh Indeed applications. Showing saved status." : "";
      status.hidden = !status.textContent;
      content.replaceChildren(...(jobs.length ? [] : [note]), status, list);
    };
  };
  globalThis.jobSearchCompanion.indeedToApply = Object.freeze({ createRenderer });
})();
