# Indeed blocker checker

The checker uses Sign in with ChatGPT plan usage through the public Responses API. It operates on descriptions Indeed has already loaded; it does not fetch unopened jobs. Full CV analysis stays under **Analyse with CV Fit Advisor** and **N**.

## Connect and enable

1. Run `npm ci` in the project checkout, then install/start the existing local bridge. After updating, reinstall the bridge using [the setup guide](setup.md) so its generated configuration and service identity match the checkout.
2. Reload the unpacked extension and refresh Indeed pages.
3. Click the extension toolbar action to open settings.
4. Choose **Continue with ChatGPT**, finish browser sign-in, and grant ChatGPT plan usage. Sign-in without this grant leaves checking disabled.
5. Choose a checker model and an optional separate **CV indexing model** from your account's catalog (for example, Luna checks with Sol indexing), turn on **Enable blocker checks**, and save.

The bridge reads relevant constraint/profile facts from `~/Job Hunting/profile.md`
and `~/.codex/skills/apply-to-jobs/references/profile.md`. Contact and unrelated
sensitive disclosure fields are omitted. Profile facts, CV excerpts and accepted
self-reported corrections are supplied evidence, not independent verification.
Missing/unreadable profile files prevent checking. Edit the source profile files
or CVs to update evidence; changes invalidate prior checks.

The checker builds a compact, source-backed experience index from the top-level
Lawrence CV files (`Lawrence_Awe_*CV*` and `Folarin CV D`) in `~/Job Hunting`;
staged upload copies and application proofs are excluded. Word and PDF variants
are both checked, and identical text is deduplicated. CV excerpts retain paid-work,
training, project and qualification context.

Settings distinguishes a current CV index from one that will refresh on the next
check. The index refreshes automatically after a CV is added, edited or removed,
using the selected indexing model/account. **Use checker model** uses
the checker model for indexing; an explicit indexing model remains independent.
Changing the indexing model invalidates the index and saved blocker checks, and rebuilds
the index on the next check. Indexing requires Poppler (`brew install poppler`)
for PDFs and macOS `textutil` for Word documents. The first refresh takes an
additional model request; unchanged CVs reuse the local index without another
indexing request. A failed refresh prevents a result rather than reusing stale
evidence. Classification policy is described under [processing and findings](#processing-and-findings).

## Processing and findings

Only complete descriptions verified against the selected job are checked. Unsupported layouts wait for a matching description.

**Enable blocker checks** controls both automatic checks and the manual **Check now** and **Recheck** actions. **Off** means checking is disabled. **Paused** means checking is enabled but needs attention before it can resume.

Automatic checks begin after you view a selected job for 1.5 seconds. Recent selections
are checked first; a running check continues when you select another job. Checks
have a 90-second timeout. Turning checking off, clearing results, changing
accounts, or stopping the bridge cancels pending work.

An invalid checker response gets one automatic correction attempt within the
90-second timeout. If validation still fails, the message identifies the response
problem and says blocker status is unknown; this is a checker failure, not a job
blocker. A failed check then needs an explicit retry. If checking pauses, review
the message in settings, resolve the connection or model issue, and choose
**Resume checks**.

The selected detail shows **Blocker check** with a collapsed finding count. Expand **Show findings** to review results in a scrollable area, challenge them, or override eligible findings. **Recheck** stays visible when results are collapsed. The expanded results show **Potential blocker** findings
or **No blockers found**. A potential blocker means an essential requirement is
not established by the supplied evidence. Its explanation distinguishes missing
or conflicting evidence from an explicit incompatibility. It does not prove that
you lack the experience or qualification.

- Only clear mandatory requirements produce findings; preferences and unclear
  requirements do not.
- Personality traits and generic soft skills are excluded.
- Work arrangements such as hours, travel, and onsite attendance produce findings
  only when your profile explicitly conflicts with the requirement.
- Application questions alone do not establish a mandatory answer.

The check does not establish overall fit or guarantee that every requirement was
recognised. Full CV analysis remains a separate action.

Cards show saved results. **Previously checked** means the description and current
evidence have not yet been verified together. Manual application marks and job
visibility are unchanged. Results from older checker contracts are discarded;
application marks and completed CV-fit analyses are retained. See `extension/contracts/blockers.js`
for the current checker version.

See [requirement policy](design.md#requirement-policy) and
[scheduling details](design.md#scheduling-and-storage-contracts) for implementation rules.

## Challenging a blocker

Each check and recheck prepares a concise suggested challenge (one sentence,
at most 25 words) alongside every blocker.
Choose **Challenge** beneath a finding to open that draft immediately, with all
its text selected. Type or delete to replace it, or click in the field to clear
the selection and keep or edit the suggestion, then choose **Send challenge**.
Suggestions use the advert and existing evidence without inventing candidate
facts; generating a suggestion does not change your profile. Edited drafts,
including an emptied field, are preserved when you cancel and reopen the form.
The model reviews the full advert again and gives a direct response explaining whether the
challenge is accepted or the blocker remains. Other requirements are still
checked. A challenge is evidence to assess, not an automatic override. A direct
confirmation of physical fitness and readiness for demanding work can resolve that
general requirement without a CV entry or medical certificate, unless the advert
explicitly requires proof. It does not establish separate employment references
or work history. An inconsistent challenge decision receives one corrective review
before the request fails; all requirements are retained and validated again.

When accepted, concrete reusable factual corrections are integrated into the
configured profile files for future checks. Superseded facts are removed from
those sources and concise current facts are kept under **Blocker-check
clarifications** in the application profile (or the first configured profile).
CV files are not edited. The review cannot overwrite a profile edited during
inference; retry against the updated profile instead. Profile changes invalidate
older results, and queued checks read the latest evidence before inference.

Rejected challenges, advert-specific interpretations and job-specific exceptions
are not added to the profile. The latest review reply replaces the result for
that job; the checker does not save challenge notes or append a challenge
history. **Recheck** uses the current profile without replaying the objection.
A failed request leaves the prior findings visible and shows an error so the
challenge can be retried. Accepted profile corrections remain when saved
findings are cleared.

If a challenge is rejected, choose **Override for this job** to dismiss that
specific blocker yourself. The original finding and AI reply remain visible,
and **Undo override** restores it. Other blockers still count. When every
blocker is overridden, the card says **Blockers overridden by you**. Overrides
are saved with this check, sync across tabs, and do not change your profile.
A completed recheck or another challenge replaces the check and resets its overrides.

### Preparing and queuing challenges

While a challenge is being reviewed, you can open other findings, edit their
prepared objections, and choose **Queue challenge**. Only the queued or currently
reviewed finding is locked against duplicate submission. Reviews run one at a
time in submission order, and each starts with the latest profile and CV evidence,
including corrections accepted by earlier reviews. Open drafts retain their text
and cursor position as results update. **Recheck** waits until the queue finishes.
A failed review is shown with its requirement; other queued reviews can continue
unless checking is unavailable. Accepted reviews show **Challenge accepted** without an explanation. Rejected
reviews explain only why the challenged requirement remains a blocker; other
findings stay in the findings list.

The queue and unsent drafts belong to the current page session. Reloading or
closing the page discards waiting challenges and drafts. A review already sent
to the bridge can still finish.

## Fallback accounts

In **ChatGPT connection**, add your other accounts through **Add account**, completing sign-in with plan usage enabled for each. Enable **Account fallback** and save. Fallback is off by default.

**Current account** is used first. Fallback accounts are listed by email in the order they will be tried. After an automatic switch, the selected fallback becomes the current account.

Fallback retries only when ChatGPT confirms a plan usage limit (`subscription_sharing_usage_limit_exceeded`), including a limit reported during streaming or CV indexing. It retains the selected model for each stage and skips accounts without the model needed by the stage that failed. Each distinct subscriber is tried once across the index refresh and job check, in the listed order. Signed-out accounts and duplicate registrations for the same subscriber are excluded, as are accounts with rejected credentials/access. A completed CV index is reused when retrying the job check. Subsequent queued checks use the newly selected account. Temporary rate limits, network errors, and unrelated failures do not switch accounts.

When no fallback can continue, the check fails and queued checks pause. Use **Manage usage**, reconnect an account, or select another model and resume. Limits may be app-specific; the error does not establish that an entire plan is empty or when it resets. No API-key billing is used. Turning checks off, changing accounts or fallback settings, clearing findings, and shutdown cancel pending fallback work.

## Cache and account data

Each store retains at most 300 saved check results. A result may contain several
findings or none. Results expire after 30 days and are removed from persisted
storage when a later result is saved.

**Clear saved blocker checks** removes saved check results from both the bridge cache
and extension records without changing manual marks. Cleared badges disappear;
eligible selected jobs can be checked again automatically. This does not remove
the CV index or accepted profile corrections.

The index is saved privately as `cv-index.json` in the checker data directory, with exact CV passages, the indexing model and source fingerprints. Full CV text is sent only when refreshing the index; routine checks send the compact excerpts and profile facts.

Checker data lives in `~/Library/Application Support/Job Search Companion/blockers/`. OAuth tokens remain in the bridge. Signing out clears local credentials and attempts remote revocation; settings reports if revocation is unconfirmed. Sign-out preserves the issued registration and stable host ID. Multiple registrations remain distinct even when they use the same email. Changing accounts or starting sign-in turns checks off and clears model selection.

## Limitations and validation

Unsupported model capabilities pause checking for settings review. Finding a model in the catalog does not establish that it supports checking for your account. Live sign-in, account-specific model admission, and structured-output support require verification with an eligible ChatGPT account.

GPT-6 Luna requests Fast processing (`service_tier: "priority"`), but the delivered tier remains unconfirmed. Settings shows this as a processing request, not a verified latency guarantee. Other models use their default processing tier and reasoning level.

For GPT-6 Luna, **Checker reasoning level** selects **Light (low)** or **Medium** and sends an explicit `reasoning.effort`. Medium remains the default. Saving a different level cancels pending checks and keeps results from the previous level from being reused as current findings. Account fallback retains the chosen level. This control applies to job checks. CV indexing uses Medium for GPT-6 Luna and the model default for other models; its processing tier follows the indexing model.

Evaluation commands, methodology and historical measurements are documented in [evaluations](evaluations/README.md).

See [checker internals and validation notes](design.md#blocker-checking-internals) for description capture, storage contracts, and automated coverage.

Official documentation: [Sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
