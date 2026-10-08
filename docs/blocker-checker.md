# Indeed blocker checker

The checker uses Sign in with ChatGPT plan usage through the public Responses API. It operates on descriptions Indeed has already loaded; it does not fetch unopened jobs. Full CV analysis stays under **Analyse with CV Fit Advisor** and **N**.

## Connect and enable

1. Run `npm ci` in the project checkout, then install/start the existing local bridge. After updating, reinstall the bridge using [the setup guide](setup.md) so its generated configuration and service identity match the checkout.
2. Reload the unpacked extension and refresh Indeed pages.
3. Click the extension toolbar action to open settings.
4. Choose **Continue with ChatGPT**, finish browser sign-in, and grant ChatGPT plan usage. Sign-in without this grant leaves checking disabled.
5. Choose a model from your account's catalog, turn on **Enable blocker checks**, and save.

The bridge reads relevant facts from `~/Job Hunting/profile.md` and `~/.codex/skills/apply-to-jobs/references/profile.md`. Contact and unrelated sensitive disclosure fields are omitted. Missing/unreadable profile files prevent checking. Edit the verified source files to update facts; changes invalidate prior checks. Semantically conflicting evidence stays uncertain.

## Processing and findings

Only complete descriptions verified against the selected job are checked. Unsupported layouts wait for a matching description.

**Enable blocker checks** controls both automatic checks and the manual **Check now** and **Recheck** actions. **Off** means checking is disabled. **Paused** means checking is enabled but needs attention before it can resume.

Automatic checks begin after a 1.5-second dwell in a visible tab. One model request runs at a time. Recent eligible selections take precedence over waiting jobs, with at most ten waiting checks. Already-running checks finish when selection changes; turning checks off, clearing findings, shutdown, and account changes cancel work. Identical checks share a task across tabs. Requests time out after 90 seconds. Failed checks require an explicit retry; transient failures do not retry automatically or switch billing.

The selected detail shows **Confirmed blocker**, **Uncertain requirement**, or **No blockers found**, with requirement excerpts and profile evidence. Confirmed blockers require an explicit mandatory requirement and contradictory verified evidence. Absence of evidence stays uncertain. Completed cards receive compact badges; unopened cards can show **Previously checked** but are never claimed current before their description is verified. Manual marks and job visibility are not changed.

## Fallback accounts

In **ChatGPT connection**, add your other accounts through **Add account**, completing sign-in with plan usage enabled for each. Enable **Account fallback** and save. Fallback is off by default.

**Current account** is used first. Fallback accounts are listed by email in the order they will be tried. After an automatic switch, the selected fallback becomes the current account.

Fallback retries the same check and model only when ChatGPT confirms a plan usage limit (`subscription_sharing_usage_limit_exceeded`), including a limit reported during streaming. It tries each distinct subscriber once, in the listed order. Signed-out accounts and duplicate registrations for the same subscriber are excluded. Accounts without the selected model or with rejected credentials/access are skipped. Subsequent queued checks use the newly selected account. Temporary rate limits, network errors, and unrelated failures do not switch accounts.

When no fallback can continue, the check fails and queued checks pause. Use **Manage usage**, reconnect an account, or select another model and resume. Limits may be app-specific; the error does not establish that an entire plan is empty or when it resets. No API-key billing is used. Turning checks off, changing accounts or fallback settings, clearing findings, and shutdown cancel pending fallback work.

## Cache and account data

Each store keeps at most 300 saved findings on this device for up to 30 days. **Clear saved findings** clears both the bridge cache and extension records without changing manual marks. Older findings may appear as **Previously checked** until their description and profile are verified again.

Checker data lives in `~/Library/Application Support/Job Search Companion/blockers/`. OAuth tokens remain in the bridge. Signing out clears local credentials and attempts remote revocation; settings reports if revocation is unconfirmed. Sign-out preserves the issued registration and stable host ID. Multiple registrations remain distinct even when they use the same email. Changing accounts or starting sign-in turns checks off and clears model selection.

## Limitations and validation

Unsupported model capabilities pause checking for settings review. Finding a model in the catalog does not establish that it supports checking for your account. Live sign-in, account-specific model admission, and structured-output support require verification with an eligible ChatGPT account.

GPT-6 Luna requests Fast processing (`service_tier: "priority"`), but the delivered tier remains unconfirmed. Settings shows this as a processing request, not a verified latency guarantee. Other models use their default processing tier and reasoning level.

For GPT-6 Luna, **Reasoning level** selects **Light (low)** or **Medium** and sends an explicit `reasoning.effort`. Medium remains the default. Saving a different level cancels pending checks and keeps results from the previous level from being reused as current findings. Account fallback retains the chosen level.

On 9 October 2026, 12 live requests compared low and medium using the same verified profile, three sample descriptions and Fast processing. Two rounds alternated request order. Median completion time was **2.59 seconds for Light** and **2.44 seconds for Medium**: Light was 6.2% slower in this small sample, so no automatic switch was made. The switch threshold was a 20% reduction with all fixture outcomes passing. Low passed all six outcomes; medium passed five, missing the uncertain DBS requirement once in an advert containing an instruction injection. These synthetic cases are a limited check, not a comprehensive accuracy evaluation or a promise of future latency. Full inputs, timings and outcomes are in [the benchmark report](blocker-benchmark.json).

Run `node scripts/benchmark-blockers.js` to repeat this comparison using the currently connected account and verified profile. It uses ChatGPT plan usage, requires a fresh access token, and does not change checker settings, saved findings, accounts or credentials.

See [checker internals and validation notes](design.md#blocker-checking-internals) for description capture, storage contracts, and automated coverage.

Official documentation: [Sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
