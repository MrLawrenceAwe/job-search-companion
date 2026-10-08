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

**Enable blocker checks** controls both automatic checks and the manual **Check now** and **Recheck** actions.

Automatic checks begin after a 1.5-second dwell in a visible tab. One model request runs at a time. Recent eligible selections take precedence over waiting jobs, with at most ten waiting checks. Already-running checks finish when selection changes; pause, cache clearing, shutdown, and account changes cancel work. Identical checks share a task across tabs. Requests time out after 90 seconds. Failed checks require an explicit retry; transient failures do not retry automatically or switch billing.

The selected detail shows **Clear blocker**, **Uncertain requirement**, or **No blockers found**, with requirement excerpts and profile evidence. Clear blockers require an explicit mandatory requirement and contradictory verified evidence. Absence of evidence stays uncertain. Completed cards receive compact badges; unopened cards can show **Previously checked** but are never claimed current before their description is verified. Manual marks and job visibility are not changed.

## Fallback accounts

In **ChatGPT connection**, add your other accounts through **Add account**, completing sign-in with plan usage enabled for each. Enable **Account fallback** and save. Fallback is off by default.

**Current account** is used first. Fallback accounts are listed by email in the order they will be tried. After an automatic switch, the selected fallback becomes the current account.

Only the confirmed `subscription_sharing_usage_limit_exceeded` error triggers fallback, including errors received during streaming. The failed check is retried using the same model on other connected accounts in account-list order; subsequent queued checks use the newly selected account. Each distinct subscriber is tried at most once per check. Signed-out accounts and duplicate registrations for the same subscriber are excluded. Accounts without the model or with rejected credentials/access are skipped during fallback catalog checks. Temporary rate limits, network errors, and errors on the original account other than confirmed usage exhaustion do not trigger account rotation.

When no fallback can continue, the check fails and queued checks pause. Use **Manage usage**, reconnect an account, or select another model and resume. Limits may be app-specific; the error does not establish that an entire plan is empty or when it resets. No API-key billing is used. Pausing, changing accounts or fallback settings, clearing the cache, and shutdown cancel pending fallback work.

## Cache and account data

The bridge keeps at most 300 completed results for 30 days, keyed by Indeed job ID, description hash, profile hash, prompt/checker version, and model. Card records are also bounded in extension-local storage. **Clear saved findings** clears both stores without touching manual marks. Stale results may appear as previously checked, never as a current clean result.

Checker settings, cache and ChatGPT registrations live in `~/Library/Application Support/Job Search Companion/blockers/`. Files are atomically written with mode 0600; new directories use 0700. OAuth tokens never go to Indeed content scripts or extension storage. Sign-out attempts remote refresh-token revocation, clears local credentials and preserves the issued registration and stable host ID. Settings reports unconfirmed remote revocation. Account selection/sign-in pauses checking and clears model selection. Multiple registrations remain distinct even with the same email.

## Limitations and validation

The local automated suite covers OAuth state/identity flow, protected storage, plan-compatible request shape, terminal SSE handling, evidence validation, cache invalidation, scheduling and the existing bridge authentication boundary. Live sign-in, account-specific model admission and structured-output support require verification with an eligible ChatGPT account; model catalog discovery alone does not prove inference works. Unsupported capability errors pause checking for model/settings review.

### Processing speed

GPT-6-Luna requests Fast processing (`service_tier: "priority"`), as advertised
by the connected account's model catalog. A previous live plan-usage test
reported `service_tier: "default"` despite that request, so Fast processing is
unconfirmed for that connection. Reasoning stays at the model default; other
models use their default processing tier. Selection dwell and the single-job
queue still apply.

Implementation details are in [the blocker-checking design](design.md#blocker-checking-internals).

Official documentation: [Sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models/inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
