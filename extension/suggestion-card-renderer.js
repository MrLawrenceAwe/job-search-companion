(() => {
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const appendNavigation = (article, { index, jobCount, onNavigate }) => {
    if (jobCount > 1) {
      const navigation = element("nav", "", "navigation");
      navigation.setAttribute("aria-label", "Suggested jobs");
      const previous = element("button", "‹");
      previous.type = "button"; previous.setAttribute("aria-label", "Previous suggested job"); previous.disabled = index === 0;
      const next = element("button", "›");
      next.type = "button"; next.setAttribute("aria-label", "Next suggested job"); next.disabled = index === jobCount - 1;
      previous.addEventListener("click", (event) => { if (event.isTrusted && index > 0) { onNavigate(-1); } });
      next.addEventListener("click", (event) => { if (event.isTrusted && index < jobCount - 1) { onNavigate(1); } });
      navigation.append(previous, element("span", `${index + 1} of ${jobCount}`), next);
      article.append(navigation);
    }
  };
  const appendBlockerCheck = (article, check) => {
    if (check.status === "completed") {
      const details = document.createElement("details");
      const count = check.findings.length;
      if (count) details.className = "has-blockers";
      details.append(element("summary", `${count} potential blocker${count === 1 ? "" : "s"}`));
      if (!count) details.append(element("p", check.overriddenCount
        ? "All blockers overridden by you for this check. Review the job before applying."
        : "No blockers found by the check. Review the job before applying."));
      else {
        const list = document.createElement("ul");
        for (const finding of check.findings) {
          const row = document.createElement("li");
          row.append(element("blockquote", finding.requirementQuote), element("p", finding.explanation));
          list.append(row);
        }
        details.append(list);
      }
      article.append(details);
    } else article.append(element("p", check.status === "incomplete"
      ? "Blocker check incomplete: the full description wasn’t available."
      : "Blocker check failed or unavailable. No blocker count is known.", "check-error"));
  };
  const createView = ({ job, index, jobCount, onNavigate, onAction }) => {
    const article = document.createElement("article");
    article.setAttribute("aria-label", "Job Search Companion suggestion");
    appendNavigation(article, { index, jobCount, onNavigate });
    article.append(element("small", job.suggestionKind === "toApply" ? "Job Search Companion · To apply" : "Job Search Companion · Indeed"), element("h2", job.title),
      element("p", [job.company, job.location].filter(Boolean).join(" · ")),
      element("p", job.pay, "pay"));
    if (job.suggestionKind === "toApply") article.append(element("p", `CV Fit Advisor: ${job.analysisLabel}`));
    appendBlockerCheck(article, job.blockerCheck);
    const actions = element("div", "", "actions");
    const snooze = document.createElement("details");
    snooze.append(element("summary", "Snooze"));
    const snoozeChoices = element("div", "", "actions");
    snooze.append(snoozeChoices);
    const feedback = element("p", "", "feedback");
    feedback.setAttribute("role", "status");
    const labels = [["open", "Open job"], job.suggestionKind === "toApply"
      ? ["review", "View CV Fit Advisor"] : ["analyse", "Analyse with CV Fit Advisor"], ["unsuitable", "Mark as unsuitable"], ["dismiss", "Dismiss"]];
    labels.push(...[1, 2, 3, 4, 5].map((hours) => ["snooze", `${hours} hour${hours === 1 ? "" : "s"}`, hours]));
    for (const [action, label, hours] of labels) {
      const button = element("button", label, action === "open" ? "primary" : "");
      button.type = "button";
      button.addEventListener("click", (event) => onAction(event, action, hours, button));
      (action === "snooze" ? snoozeChoices : actions).append(button);
    }
    article.append(actions, snooze, feedback);
    return {
      article,
      feedback,
      showContinue(onContinue) {
        const done = element("button", "Continue");
        done.type = "button";
        done.addEventListener("click", (event) => { if (event.isTrusted) onContinue(); });
        actions.replaceChildren(done);
        snooze.remove();
      },
    };
  };
  globalThis.jobSearchSuggestionRenderer = Object.freeze({ createView });
})();
