(() => {
  const companion = globalThis.jobSearchCompanion;
  const { labels: LABELS, isRetainableResult, getRemainingFindings, canOverrideFinding } = globalThis.jobSearchContracts.blockers;
  companion.blockers.registerRenderer = ({ recordStore, checks, getCurrentResult, startCheck, getContext }) => {
    const drafts = new Map();
    const openDrafts = new Set();
    const presentation = (result) => {
      if (result.findings.length && !getRemainingFindings(result).length)
        return { outcome: "overridden", label: "Blockers overridden by you" };
      return { outcome: result.outcome, label: LABELS[result.outcome] };
    };
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
    const ordinaryWords = new Set(
      "a an and are as at be because been being but by can candidate candidates could essential equivalent for from have having in including is it its job must need needed needs of on or our appropriate relevant required requirement requirements role should that the their them these they this to using we will with work working you your".split(" "),
    );
    const appendExplanation = (summary, finding) => {
      const words = (text) => text.match(/[\p{L}\p{N}]+/gu) || [];
      const keywords = new Set(words(finding.requirementQuote).map((word) => word.toLowerCase())
        .filter((word) => !ordinaryWords.has(word) && (word.length >= 3 || /\d/.test(word))));
      // Keep evidence caveats prominent even when they differ from the advert's wording.
      for (const word of ["no", "not", "only", "provisional", "missing", "without"]) keywords.add(word);
      for (const part of finding.explanation.split(/([\p{L}\p{N}]+)/u))
        summary.append(keywords.has(part.toLowerCase())
          ? element("strong", part)
          : document.createTextNode(part));
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
      const { selection, checkerState, challenges = [] } = getContext();
      for (const badge of document.querySelectorAll(".jsc-blocker-badge")) badge.remove();
      for (const [card, jobUrl] of cards) {
        const jobId = keyFromUrl(jobUrl);
        const record = recordStore.get(jobId);
        if (!isRetainableResult(record)) continue;
        const verified = selection?.jobId === jobId && getCurrentResult() === record;
        const display = presentation(record);
        const badge = element(
          "span",
          `${display.label}${verified ? "" : " · Previously checked"}`,
          `jsc-blocker-badge jsc-${display.outcome}`,
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
      const renderSignature = `${JSON.stringify(challenges.map(({ challenge, status, error }) => ({ challenge, status, error })))}:${selection.jobId}:${selection.descriptionHash}:${JSON.stringify(checks.get(selection.signature))}:${getCurrentResult()?.checkedAt}:${JSON.stringify(getCurrentResult()?.overriddenRequirementQuotes)}:${checkerState?.settings.enabled}:${checkerState?.pausedReason}:${checkerState?.error}`;
      if (panel && panel.dataset.signature === renderSignature) return;
      const focused = panel?.contains(document.activeElement) && document.activeElement.matches("textarea")
        ? { key: document.activeElement.dataset.draftKey, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
      const previousScroll = panel?.querySelector(".jsc-blocker-result-body")?.scrollTop || 0;
      const previousResults = panel?.querySelector(".jsc-blocker-results");
      const keepResultsOpen = panel?.dataset.jobId === selection.jobId && previousResults?.open;
      panel?.remove();
      panel = element("section", null, "jsc-blocker-panel");
      panel.dataset.jobId = selection.jobId;
      panel.dataset.signature = renderSignature;
      panel.setAttribute("aria-label", "Job Search Companion blocker check");
      const result = getCurrentResult();
      if (result) panel.classList.add(`jsc-${presentation(result).outcome}`);
      const check = checks.get(selection.signature);
      let label = result
        ? "Blocker check"
        : check?.status === "checking"
          ? "Checking blockers…"
          : check?.status === "queued"
            ? "Waiting to check…"
            : check?.error ||
              checkerState?.pausedReason ||
              checkerState?.error ||
              (!checkerState?.settings.enabled ? "Blocker checks off" : "Not checked yet");
      const pendingChallenges = challenges.filter((entry) => ["queued", "reviewing"].includes(entry.status));
      const busy = ["checking", "queued"].includes(check?.status) || pendingChallenges.length > 0;
      panel.append(element("strong", label));
      if (result && busy) panel.append(element("p", pendingChallenges.length
        ? `${pendingChallenges.some((entry) => entry.status === "reviewing") ? "Reviewing one challenge" : "Waiting to review"} · ${pendingChallenges.filter((entry) => entry.status === "queued").length} queued`
        : "Reviewing…"));
      for (const entry of challenges.filter((entry) => entry.error))
        panel.append(element("p", `${entry.challenge.requirementQuote}: ${entry.error}`, "jsc-blocker-error"));
      if (result && check?.error) panel.append(element("p", check.error, "jsc-blocker-error"));
      if (result) {
        const results = element("details", null, "jsc-blocker-results");
        results.open = Boolean(keepResultsOpen);
        const count = getRemainingFindings(result).length;
        results.append(element("summary", result.findings.length
          ? `${count} potential blocker${count === 1 ? "" : "s"} · Show findings`
          : "No blockers found · Show details"));
        const resultBody = element("div", null, "jsc-blocker-result-body");
        results.append(resultBody);
        panel.append(results);
        if (presentation(result).outcome === "overridden") resultBody.append(element("p", "Blockers overridden by you for this job. Recheck assesses them again."));
        resultBody.append(
          element(
            "p",
            `Checked ${new Date(result.checkedAt).toLocaleString()} against your current profile and CV evidence.`,
          ),
        );
        if (result.challengeReview) {
          const review = element("div", null, "jsc-blocker-review");
          review.setAttribute("role", "status");
          review.append(element("strong", result.challengeReview.accepted ? "Challenge accepted" : "Finding retained"),
            element("p", `Challenged requirement: “${result.challengeReview.requirementQuote}”`));
          if (!result.challengeReview.accepted) review.append(element("p", result.challengeReview.response));
          if (result.challengeReview.profileUpdated) review.append(element("p", "Your profile has been updated for future checks."));
          resultBody.append(review);
        }
        if (!result.findings.length)
          resultBody.append(
            element(
              "p",
              "No blockers found in this description against your current profile. This check does not establish overall fit.",
            ),
          );
        for (const finding of result.findings) {
          const overridden = result.overriddenRequirementQuotes?.includes(finding.requirementQuote);
          const details = element("details");
          const summary = element("summary");
          summary.append(
            element("strong", LABELS[finding.kind]),
            document.createTextNode(" — "),
            element("strong", `Job requirement: “${finding.requirementQuote}”`),
            element("br"),
            document.createTextNode("Your evidence: "),
          );
          appendExplanation(summary, finding);
          details.append(summary);
          for (const fact of finding.evidenceFacts || [])
            details.append(element("p", `${fact.source}: ${fact.text}`));
          if (!finding.evidenceFacts?.length)
            details.append(
              element("p", "Your profile and CV evidence do not establish this requirement."),
            );
          const row = element("div", null, "jsc-blocker-finding");
          row.append(details);
          if (overridden) row.append(element("p", "Overridden by you for this job. The AI finding is retained."));
          const form = element("form", null, "jsc-blocker-challenge");
          const draftKey = `${selection.jobId}:${selection.descriptionHash}:${finding.requirementQuote}`;
          const challengeState = challenges.find((entry) => entry.challenge.requirementQuote === finding.requirementQuote);
          const pending = ["queued", "reviewing"].includes(challengeState?.status);
          form.hidden = !openDrafts.has(draftKey) || pending;
          const inputLabel = element("label", "Why should this finding be reconsidered?");
          const input = element("textarea");
          input.required = true;
          input.maxLength = 2000;
          input.rows = 3;
          input.dataset.draftKey = draftKey;
          input.value = drafts.get(draftKey) ?? (pending || challengeState?.error ? challengeState.challenge.reason : finding.suggestedChallenge);
          input.placeholder = "Explain the mistake or add a factual correction. Accepted reusable facts update your profile.";
          input.addEventListener("input", () => {
            input.setCustomValidity("");
            drafts.set(draftKey, input.value);
            if (drafts.size > 20) drafts.delete(drafts.keys().next().value);
          });
          inputLabel.append(input);
          const actions = element("div", null, "jsc-blocker-controls");
          const submit = button(busy ? "Queue challenge" : "Send challenge", () => form.requestSubmit());
          submit.disabled = pending || !checkerState?.settings.enabled || !checkerState?.connectionStatus.planUsageEnabled || Boolean(checkerState?.pausedReason);
          const cancel = button("Cancel", () => { openDrafts.delete(draftKey); form.hidden = true; toggle.hidden = false; });
          actions.append(submit, cancel);
          form.append(inputLabel, actions);
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!input.value.trim()) {
              input.setCustomValidity("Explain why this finding should be reconsidered.");
              input.reportValidity();
              return;
            }
            if (submit.disabled) return;
            drafts.delete(draftKey);
            openDrafts.delete(draftKey);
            void startCheck(true, { requirementQuote: finding.requirementQuote, reason: input.value.trim() });
          });
          const toggle = button(pending ? challengeState.status === "queued" ? "Challenge queued" : "Reviewing challenge…" : "Challenge", () => {
            openDrafts.add(draftKey);
            form.hidden = false;
            toggle.hidden = true;
            input.focus();
            input.select();
          });
          toggle.disabled = submit.disabled;
          toggle.hidden = !form.hidden;
          if (!overridden) row.append(toggle, form);
          if (overridden || canOverrideFinding(result, finding.requirementQuote)) {
            const override = button(overridden ? "Undo override" : "Override for this job", async () => {
              override.disabled = true;
              try {
                await recordStore.setFindingOverride(result, finding.requirementQuote, !overridden);
              } catch (error) {
                row.append(element("p", error.message, "jsc-blocker-error"));
                override.disabled = busy;
              }
            });
            override.disabled = busy;
            override.title = overridden ? "Restore this blocker." : "Dismiss this blocker for this check only. Your profile stays unchanged; rechecking resets the override.";
            row.append(override);
          }
          resultBody.append(row);
        }
      }
      const controls = element("div", null, "jsc-blocker-controls");
      const checkButton = button(result ? "Recheck" : "Check now", () => void startCheck(true));
      checkButton.disabled =
        !checkerState?.settings.enabled ||
        !checkerState?.connectionStatus.planUsageEnabled ||
        busy;
      controls.append(checkButton);
      panel.append(controls);
      findings.append(panel);
      const resultBody = panel.querySelector(".jsc-blocker-result-body");
      if (resultBody) resultBody.scrollTop = previousScroll;
      if (focused) {
        const input = [...panel.querySelectorAll("textarea")].find((node) => node.dataset.draftKey === focused.key);
        if (input && !input.closest("form").hidden) {
          input.focus({ preventScroll: true });
          input.setSelectionRange(focused.start, focused.end);
        }
      }
    };
    companion.pageDecorations.register(render);
  };
})();
