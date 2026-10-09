(() => {
  const companion = globalThis.jobSearchCompanion;
  const { labels: LABELS, isRetainableResult } = globalThis.jobSearchContracts.blockers;
  companion.blockers.createRenderer = ({ recordStore, checks, getCurrentResult, startCheck, getContext }) => {
    const keyFromUrl = (url) => {
      try {
        return new URL(url).searchParams.get("jk");
      } catch {
        return null;
      }
    };
    const element = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const button = (label, click) => {
      const node = element("button", label);
      node.type = "button";
      node.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        click();
      });
      return node;
    };
    const render = ({ cards, findings }) => {
      const { selection, checkerState } = getContext();
      for (const badge of document.querySelectorAll(".jsc-blocker-badge")) badge.remove();
      for (const [card, jobUrl] of cards) {
        const jobId = keyFromUrl(jobUrl);
        const record = recordStore.get(jobId);
        if (!isRetainableResult(record)) continue;
        const verified = selection?.jobId === jobId && getCurrentResult() === record;
        const badge = element(
          "span",
          `${LABELS[record.outcome]}${verified ? "" : " · Previously checked"}`,
          `jsc-blocker-badge jsc-${record.outcome}`,
        );
        badge.title = `Checked ${new Date(record.checkedAt).toLocaleString()}. Open this job to verify its description against the current profile.`;
        card.append(badge);
      }
      if (!findings) return;
      let panel = findings.querySelector('.jsc-blocker-panel');
      if (!selection) {
        if (panel?.dataset.signature === "unavailable") return;
        panel?.remove();
        panel = element("section", null, "jsc-blocker-panel");
        panel.dataset.signature = "unavailable";
        panel.append(
          element("strong", "Not checked · waiting for a full description"),
          element("p", "The job and its complete description must match before checking."),
        );
        findings.append(panel);
        return;
      }
      const renderSignature = `${selection.jobId}:${selection.descriptionHash}:${JSON.stringify(checks.get(selection.signature))}:${getCurrentResult()?.checkedAt}:${checkerState?.settings.enabled}:${checkerState?.pausedReason}:${checkerState?.error}`;
      if (panel && panel.dataset.signature === renderSignature) return;
      panel?.remove();
      panel = element("section", null, "jsc-blocker-panel");
      panel.dataset.signature = renderSignature;
      panel.setAttribute("aria-label", "Job Search Companion blocker check");
      const result = getCurrentResult();
      if (result) panel.classList.add(`jsc-${result.outcome}`);
      const check = checks.get(selection.signature);
      let label = result
        ? LABELS[result.outcome]
        : check?.status === "checking"
          ? "Checking requirements…"
          : check?.status === "queued"
            ? "Waiting to check…"
            : check?.error ||
              checkerState?.pausedReason ||
              checkerState?.error ||
              (!checkerState?.settings.enabled ? "Blocker checks off" : "Not checked yet");
      panel.append(element("strong", label));
      if (result) {
        panel.append(
          element(
            "p",
            `Checked ${new Date(result.checkedAt).toLocaleString()} against your current profile and CV evidence.`,
          ),
        );
        if (!result.findings.length)
          panel.append(
            element(
              "p",
              "No blockers found in this description against your current profile. This check does not establish overall fit.",
            ),
          );
        for (const finding of result.findings) {
          const details = element("details");
          details.append(
            element(
              "summary",
              `${LABELS[finding.kind]}: ${finding.explanation}`,
            ),
          );
          details.append(element("blockquote", finding.requirementQuote));
          for (const fact of finding.profileFacts || [])
            details.append(element("p", `${fact.source}: ${fact.text}`));
          if (!finding.profileFacts?.length)
            details.append(
              element("p", "Your profile and CV evidence do not establish this requirement."),
            );
          panel.append(details);
        }
      }
      const controls = element("div", null, "jsc-blocker-controls");
      const checkButton = button(result ? "Recheck" : "Check now", () => void startCheck(true));
      checkButton.disabled =
        !checkerState?.settings.enabled ||
        !checkerState?.connectionStatus.planUsageEnabled ||
        ["checking", "queued"].includes(check?.status);
      controls.append(checkButton);
      panel.append(controls);
      findings.append(panel);
    };
    companion.pageDecorations.register(render);
    return companion.pageDecorations.schedule;
  };
})();
