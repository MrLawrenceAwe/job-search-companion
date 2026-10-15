# Using Job Search Companion

Applied and unsuitable marks are manual records in this Chrome profile. Mark a
listing after applying on the employer's website; marks do not update Indeed or
LinkedIn's application history. Removing the extension clears these local records.

On Indeed, **Mark as applied** is hidden in the detail pane and menu when the
job has an Easily apply badge or Indeed Apply control. Use it for jobs that
require an employer website, email, or another application route. Saved badges
remain visible, and **Mark as unsuitable** stays available.

Use **J/K** to navigate rendered results, **H** to hide a result on the current
page, and **U** to undo navigation or hiding. Shortcuts ignore editable fields;
hidden results return after reload.

**Analyse with CV Fit Advisor** and **N** prepare a task using the local bridge.
Blocker checks operate on complete loaded Indeed descriptions; see the
[blocker-checker guide](blocker-checker.md). Installation and bridge recovery are
in [setup](setup.md).

## Completed CV-fit analyses

New CV-fit submissions include a job-specific completion command. When Codex
finishes the assessment, it records the chat ID with the local bridge. The
extension then shows **Analysed · Open analysis** on the job card and in the
job detail controls, normally within 30 seconds. The action opens the saved
chat through macOS using the bridge, like task submission; it does not use
Chrome’s external-app confirmation.

Submitting a task, preparing a draft, or failing an assessment does not create
an analysed mark. Completed negative fit assessments do. The records survive
bridge restarts and page reloads. Opening an analysis requires the bridge to be
running; existing marks remain visible while it is offline. Earlier chats
without a completion callback are not automatically marked.

Analysed marks are green for **use as-is**, yellow for **edit the CV**, and red
for **do not apply yet**. Other verdicts and earlier records without a verdict
are blue. Hover over a mark to see its recorded verdict.
