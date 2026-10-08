(() => {
  const companion = globalThis.jobSearchCompanion;
  const { labels: LABELS, isValidRecord: validRecord } = globalThis.jobSearchContracts.blockers;
  companion.blockers.createRenderer = ({ records, checks, currentRecord, start, getContext }) => {
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
    const openSettings = () => chrome.runtime.sendMessage({ type: "OPEN_BLOCKER_SETTINGS" });
    return () => {
      const { selection, checkerState } = getContext();
      for (const badge of document.querySelectorAll(".jsc-blocker-badge")) badge.remove();
      const decorated = new Set();
      for (const { element: carrier, jobUrl } of companion.jobs.collectJobs(
        companion.dom.getRenderedRect,
      )) {
        const jobId = keyFromUrl(jobUrl);
        const record = records.get(jobId);
        const card = carrier.closest(companion.selectors.jobCard);
        if (!card || decorated.has(card) || !validRecord(record)) continue;
        decorated.add(card);
        const verified = selection?.jobId === jobId && currentRecord() === record;
        const badge = element(
          "span",
          `${LABELS[record.outcome]}${verified ? "" : " · Previously checked"}`,
          `jsc-blocker-badge jsc-${record.outcome}`,
        );
        badge.title = `Checked ${new Date(record.checkedAt).toLocaleString()}. Open this job to verify its description against the current profile.`;
        card.append(badge);
      }
      let panel = document.querySelector(".jsc-blocker-panel");
      const heading = [...document.querySelectorAll(companion.selectors.jobDetailTitle)].find(
        (node) => companion.dom.getRenderedRect(node),
      );
      if (!heading) {
        panel?.remove();
        return;
      }
      if (!selection) {
        if (panel?.dataset.signature === "unavailable") return;
        panel?.remove();
        panel = element("section", null, "jsc-blocker-panel");
        panel.dataset.signature = "unavailable";
        panel.append(
          element("strong", "Not checked · waiting for a full description"),
          element("p", "The job and its complete description must match before checking."),
          button("Checker settings", openSettings),
        );
        heading.after(panel);
        return;
      }
      const renderSignature = `${selection.jobId}:${selection.hash}:${JSON.stringify(checks.get(selection.signature))}:${currentRecord()?.checkedAt}:${checkerState?.settings.enabled}:${checkerState?.pausedReason}:${checkerState?.error}`;
      if (panel && panel.dataset.signature === renderSignature) return;
      panel?.remove();
      panel = element("section", null, "jsc-blocker-panel");
      panel.dataset.signature = renderSignature;
      panel.setAttribute("aria-label", "Job Search Companion blocker check");
      const result = currentRecord();
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
              (!checkerState?.settings.enabled ? "Blocker checks paused" : "Not checked yet");
      panel.append(element("strong", label));
      if (result) {
        panel.append(
          element(
            "p",
            `Checked ${new Date(result.checkedAt).toLocaleString()} against your current verified profile.`,
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
              `${finding.kind === "clear_blocker" ? "Clear blocker" : "Uncertain requirement"}: ${finding.explanation}`,
            ),
          );
          details.append(element("blockquote", finding.requirementQuote));
          for (const fact of finding.profileFacts || [])
            details.append(element("p", `${fact.source}: ${fact.text}`));
          if (!finding.profileFacts?.length)
            details.append(
              element("p", "Your verified profile does not establish this requirement."),
            );
          panel.append(details);
        }
      }
      const controls = element("div", null, "jsc-blocker-controls");
      const checkButton = button(result ? "Recheck" : "Check now", () => void start(true));
      checkButton.disabled =
        !checkerState?.settings.enabled ||
        !checkerState?.session.sharing ||
        ["checking", "queued"].includes(check?.status);
      controls.append(checkButton, button("Checker settings", openSettings));
      panel.append(controls);
      heading.after(panel);
    };
  };
})();
