# Indeed suggestions

A scheduled Codex check reads the personalised **Jobs for you** homepage every
30 minutes in the built-in browser. It inspects up to 30 rendered cards, prioritises
Welwyn Garden City, Hatfield and fully remote jobs, then collects up to five and
opens their detail panes inside that hidden tab to read full descriptions. It
never opens a sign-in or verification window. Sign-out, a challenge, or uncertain
account access invalidates the batch and ends that run quietly. Later scheduled
runs may check access again without prompting.

The extension displays one compact stack of up to five jobs in the top-right corner
per 30 minutes over an ordinary HTTP or
HTTPS webpage. Its isolated content script checks page visibility and displays
its own closed shadow tree; it does not inspect forms, passwords, or page content.
It does not focus controls, play sounds, show OS notifications or open a job tab
unless the user clicks **Open job**. Chrome's internal pages, the Web Store, and
other restricted pages cannot host the card. Existing pages need refreshing after
extension reload to load a new content script.

## The card

Every 30-minute delivery alternates between new Indeed recommendations and saved
**To apply** reminders. If one source has no ready jobs, the other fills the slot.
The next source and reminder rotation persist across restarts. Reminders use the
same eligible Indeed analyses as the To apply list: **Use as is** and **Edit CV**,
excluding applied, unsuitable, Indeed-dismissed and known expired jobs. Previously
reminded jobs rotate behind jobs not yet reminded; the 30-day new-job history does
not suppress reminders. Saved reminders can appear even when the feed is unavailable.
The card identifies **To apply**, shows the saved verdict, and offers **View CV Fit
Advisor** to reopen that assessment instead of starting another one. Snooze pauses
both sources. A job in To apply is excluded from new recommendations.

When a new completed CV Fit Advisor assessment syncs with the exact verdict
**Do not apply yet**, the extension automatically saves an **Unsuitable** mark
for that job, on Indeed or LinkedIn. Existing marks are preserved. Repeated syncs
of the same assessment do not restore a mark the user subsequently clears; a new
assessment can mark it again. Other verdicts do not automatically mark jobs or
remove saved unsuitable marks. This takes effect on the next normal analysis sync.

The card automatically follows the browser/system light or dark preference and
updates when that preference changes. It does not copy custom Chrome theme colours
or the host website's theme. Blocker counts and findings stay red in either mode.

Welwyn Garden City, Hatfield and remote jobs take priority over other locations.
Indeed's order is retained within each group. Priority uses the location field;
mentioning a town in a job title does not make it local. Hybrid work elsewhere
does not count as fully remote. A single priority match is sufficient.
When multiple jobs are available, **Previous/Next** controls browse the stack
without opening extra popups. Acting on a job advances to the next remaining job.

Before offering a candidate, the worker requests a blocker check from the local
bridge using the captured description, existing checker settings and current
profile/CV evidence. **Checking** stays in the background. A completed check shows
an expandable **N potential blockers** count with requirement quotes and
explanations. Review overrides are respected. A failed/unavailable check or
incomplete description is explicitly labelled; it never becomes a zero-blocker
count, and the job is still offered. These checks do not claim a full CV fit verdict.
Reminders also request a check before display. If the current collected feed lacks
that saved job's full description, its blocker check is labelled unavailable rather
than treating its saved CV Fit Advisor verdict as a zero-blocker result.

The card provides:

- **Open job**: open the canonical Indeed job in a new tab.
- **Analyse with CV Fit Advisor**: submit that job through the existing bridge
  workflow. This explicit action may open Codex, as existing CV analysis does.
- **Mark as unsuitable**: save the existing local unsuitable mark and close the card.
- **Dismiss**: remove the current suggestion without marking the job unsuitable,
  then show the next job, or close the card when none remain.
- **Snooze**: close the card and pause suggestions for 1, 2, 3, 4, or 5 hours.
  The deadline is persisted across browser/worker restarts. Collection continues.

Applied, unsuitable and known Indeed applied/dismissed jobs are omitted. Jobs
already offered are skipped for 30 days, with a bounded 1000-job history.
The **Indeed suggestions** switch in extension settings disables card delivery
immediately; pause the Codex schedule to stop collection entirely.

## Local connection

The built-in browser is a Codex tool, not an API the Chrome extension can call.
Collection requires the scheduled Codex chat and local app to be available. No
Chrome debugger or API Anything operation is used for scheduled collection.
The Mac must be on and awake with Codex running; collection cannot run while it
is shut down or asleep. Closing the lid normally sleeps the Mac, unless an awake
configuration such as external-display mode keeps it running.

The collector passes a bounded JSON batch as stdin to:

```sh
node scripts/import-recommendations.js < /path/to/private-batch.json
```

The batch has `status: "ready"`, `signedIn: true`, `feedHeading: "Jobs for you"`,
and `jobs`. Each job needs `jobUrl`, `title`, `company`, `location`, `pay`,
`description`, and `descriptionComplete`. Missing optional text is an empty string.
A full description must be verified against the selected job's identity; partial
or unavailable descriptions use `descriptionComplete: false`. Job keys come from
rendered cards, never guessed values or advertising URLs. URLs must be canonical
UK Indeed `/viewjob?jk=...` URLs. At most 30 records and 500 KB of input are accepted.

`{"status":"unavailable"}`, `{"status":"signed_out"}` or `{"status":"blocked"}`
clears the previous batch. Invalid input also invalidates it.
The private batch lives in
`~/Library/Application Support/Job Search Companion/recommendations.json`, expires
after one hour and contains job metadata/descriptions, not credentials or cookies.
The authenticated bridge exposes metadata at `GET /suggestions` and one candidate's
blocker-check status at `GET /suggestions/<job-key>/check`. Full descriptions and CV
evidence are not passed to the page card. The worker polls from visible pages at
most once a minute; its cooldown, snooze and history survive restarts.

## Installation and verification

The bridge installer does not create the collector schedule. The **Indeed
suggestions** switch controls card delivery only; it does not collect jobs.
Without a collector, saved To apply reminders can still appear.

To configure collection:

1. Use a local Codex task with this repository as its workspace, with access to
   the built-in browser and local commands. Sign in to Indeed separately before
   running collection; the collector must stop at sign-in or verification screens.
2. Ask Codex to schedule that task every 30 minutes with the following collection
   instructions (use the repository's absolute path if its workspace differs):

   > Read the signed-in UK Indeed Jobs for you feed in a hidden built-in browser
   > tab. Inspect up to 30 rendered cards. Prioritise Welwyn Garden City, Hatfield
   > and fully remote locations, preserving feed order within each group. Collect
   > up to five jobs, opening their detail panes in that hidden tab. Verify each
   > description belongs to its rendered job key. Follow the JSON contract in
   > docs/recommendations.md and pass the batch on stdin to
   > node scripts/import-recommendations.js from this repository. Use a private
   > temporary JSON file if needed and remove it afterwards. Do not open sign-in
   > or verification windows. On sign-out, verification or uncertain access,
   > import signed_out, blocked or unavailable status respectively to invalidate
   > the previous batch, then end the run. Do not submit applications or CV tasks.

3. Review the saved schedule to confirm its interval, workspace and instructions.
   Run it once and check that the import reports success. Keep the Mac awake and
   Codex running for subsequent collection. Pause this schedule to stop collection.

Build, restart the bridge, reload the same unpacked extension and refresh the
webpage used for the card. Chrome may require approval for displaying the card
across websites. No OS notification permission is needed.

Tests cover feed validation/expiry, quiet sign-out, completed/failed/pending checks,
blocker disclosure, action binding, mark filtering, persistent cooldown/snooze,
closed-shadow rendering, escaped page text and preservation of typing focus.
A hidden signed-in feed and restart persistence were verified on 2026-10-29.
Future session expiry remains controlled by Indeed.
