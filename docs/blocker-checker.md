# Indeed blocker checker

The checker uses Sign in with ChatGPT plan usage through the public Responses API. It operates on descriptions Indeed has already loaded; it does not fetch unopened jobs. Full CV analysis stays under **Analyse with CV Fit Advisor** and **N**.

## Connect and enable

1. Run `npm ci` in the project checkout, then install/start the existing local bridge. After updating, reinstall the bridge using [the setup guide](setup.md) so its generated configuration and service identity match the checkout.
2. Reload the unpacked extension and refresh Indeed pages.
3. Click the extension toolbar action to open settings.
4. Choose **Continue with ChatGPT**, finish browser sign-in, and grant ChatGPT plan usage. Sign-in without this grant leaves checking disabled.
5. Choose a checker model and an optional separate **CV indexing model** from your account's catalog (for example, Luna checks with Sol indexing), turn on **Enable blocker checks**, and save.

The bridge reads relevant constraint/profile facts from `~/Job Hunting/profile.md` and `~/.codex/skills/apply-to-jobs/references/profile.md`. Contact and unrelated sensitive disclosure fields are omitted. It also builds a compact, source-backed experience index from the top-level Lawrence CV files (`Lawrence_Awe_*CV*` and `Folarin CV D`) in `~/Job Hunting`; staged upload copies and application proofs are excluded. Word and PDF variants are both checked, and identical text is deduplicated. CV excerpts retain paid-work, training, project and qualification context; they are not treated as independently verified constraints. Missing/unreadable profile files prevent checking. Edit the verified source files or CVs to update evidence; changes invalidate prior checks. The CV index refreshes automatically on the next check after a CV is added, edited or removed, using the selected indexing model/account. **Use checker model** uses the checker model for indexing; an explicit indexing model remains independent. Changing the indexing model invalidates the index and saved findings, and rebuilds the index on the next check. Indexing requires Poppler (`brew install poppler`) for PDFs and macOS `textutil` for Word documents. The first refresh takes an additional model request; unchanged CVs reuse the local index without another indexing request. A failed refresh prevents a result rather than reusing stale evidence. Semantically conflicting evidence does not establish a requirement: essential eligibility requirements block, while unclear requirements remain uncertain. Missing or conflicting work-arrangement availability needs clarification; a mandatory work arrangement blocks only when the profile explicitly establishes incompatibility.

## Processing and findings

CV source reads and extraction honour the check's cancellation signal and 90-second
deadline. Cancellation stops active PDF/Word converters and prevents remaining
CVs from being extracted or submitted for indexing.

Only complete descriptions verified against the selected job are checked. Unsupported layouts wait for a matching description.

**Enable blocker checks** controls both automatic checks and the manual **Check now** and **Recheck** actions. **Off** means checking is disabled. **Paused** means checking is enabled but needs attention before it can resume.

Automatic checks begin after a 1.5-second dwell in a visible tab. One model request runs at a time. Recent eligible selections take precedence over waiting jobs, with at most ten waiting checks. Already-running checks finish when selection changes; turning checks off, clearing findings, shutdown, and account changes cancel work. Identical checks share a task across tabs. Requests time out after 90 seconds. A completed response with a non-verbatim requirement quote gets one corrective request within the same 90-second deadline. The complete inventory is validated again; a second quote failure shows a specific error. Other failed checks require an explicit retry; transient failures do not retry automatically or switch billing.

The model inventories candidate requirements in introductory prose and Experience/Requirements sections before the bridge derives findings. Requested sector and specialist compliance experience count even without “must”; missing CV/profile evidence blocks essential requirements and produces uncertainty for requirements whose necessity is unclear. Explicitly preferred/optional experience does not produce a blocker. Personality, motivation and generic soft-skill statements (such as self-driven, empathetic, resilient, curious or a clear communicator) are excluded, even when described as essential. Duties explaining those qualities do not imply prior specialist experience. Mixed statements still check separately stated concrete prerequisites such as sales experience, qualifications or work constraints. All requirement quotes and evidence IDs are validated. This reduces omissions but remains a model-based check, not a guarantee that every requirement was recognised.

The selected detail shows **Blocker**, **Uncertain requirement**, or **No blockers found**, with requirement excerpts and profile evidence. Essential eligibility requirements show **Blocker** whenever the current evidence is missing, conflicting or incompatible. The explanation distinguishes undocumented experience from a confirmed shortfall; missing evidence is not proof that the candidate lacks experience. Onsite attendance, working hours, location, commute, relocation, travel availability and contract duration show **Uncertain requirement** when candidate availability is missing or conflicting, even when the arrangement is mandatory. A mandatory arrangement shows **Blocker** only with explicit incompatible profile evidence. A stated willingness for one arrangement does not imply refusal of other arrangements. Experience, licences and clearance retain the essential eligibility rules. Requirements whose necessity is unclear show **Uncertain requirement**. Supported and preferred requirements produce no findings. Updating the checker invalidates older cached classifications so they are checked again. Completed cards receive compact badges; unopened cards can show **Previously checked** but are never claimed current before their description is verified. Manual marks and job visibility are not changed.

## Fallback accounts

In **ChatGPT connection**, add your other accounts through **Add account**, completing sign-in with plan usage enabled for each. Enable **Account fallback** and save. Fallback is off by default.

**Current account** is used first. Fallback accounts are listed by email in the order they will be tried. After an automatic switch, the selected fallback becomes the current account.

Fallback retries only when ChatGPT confirms a plan usage limit (`subscription_sharing_usage_limit_exceeded`), including a limit reported during streaming or CV indexing. It retains the selected model for each stage and skips accounts without the model needed by the stage that failed. Each distinct subscriber is tried once across the index refresh and job check, in the listed order. Signed-out accounts and duplicate registrations for the same subscriber are excluded, as are accounts with rejected credentials/access. A completed CV index is reused when retrying the job check. Subsequent queued checks use the newly selected account. Temporary rate limits, network errors, and unrelated failures do not switch accounts.

When no fallback can continue, the check fails and queued checks pause. Use **Manage usage**, reconnect an account, or select another model and resume. Limits may be app-specific; the error does not establish that an entire plan is empty or when it resets. No API-key billing is used. Turning checks off, changing accounts or fallback settings, clearing findings, and shutdown cancel pending fallback work.

## Cache and account data

Each store keeps at most 300 saved findings on this device for up to 30 days. **Clear saved findings** clears both the bridge cache and extension records without changing manual marks. Older findings may appear as **Previously checked** until their description and profile are verified again.

The index is saved privately as `cv-index.json` in the checker data directory, with exact CV passages, the indexing model and source fingerprints. Full CV text is sent only when refreshing the index; routine checks send the compact excerpts and profile facts.

Checker data lives in `~/Library/Application Support/Job Search Companion/blockers/`. OAuth tokens remain in the bridge. Signing out clears local credentials and attempts remote revocation; settings reports if revocation is unconfirmed. Sign-out preserves the issued registration and stable host ID. Multiple registrations remain distinct even when they use the same email. Changing accounts or starting sign-in turns checks off and clears model selection.

## Limitations and validation

Unsupported model capabilities pause checking for settings review. Finding a model in the catalog does not establish that it supports checking for your account. Live sign-in, account-specific model admission, and structured-output support require verification with an eligible ChatGPT account.

GPT-6 Luna requests Fast processing (`service_tier: "priority"`), but the delivered tier remains unconfirmed. Settings shows this as a processing request, not a verified latency guarantee. Other models use their default processing tier and reasoning level.

For GPT-6 Luna, **Reasoning level** selects **Light (low)** or **Medium** and sends an explicit `reasoning.effort`. Medium remains the default. Saving a different level cancels pending checks and keeps results from the previous level from being reused as current findings. Account fallback retains the chosen level.

Evaluation commands, methodology and historical measurements are documented in [evaluations](evaluations/README.md).

See [checker internals and validation notes](design.md#blocker-checking-internals) for description capture, storage contracts, and automated coverage.

Official documentation: [Sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
