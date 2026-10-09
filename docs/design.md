# Design

## Job records

The installer records the chosen checkout location. Keep the unpacked extension
in a stable directory so its identity and local job records remain
available. See [setup and removal](setup.md) before installing the bridge.
`job-mark-store.js` stores each manual applied or unsuitable mark separately in
`chrome.storage.local`, keyed by platform and job ID, with a normalized source
URL and ISO recording date. Per-job writes cannot overwrite unrelated marks.
The `storage` permission is used only for extension-local state. It adds no new
site access. Marks work even when the local bridge is stopped and never call a
platform API or submit an application.

An initial storage read restores marks, and storage notifications update other
tabs. A debounced DOM observer restores badges after result cards are replaced
and updates the detail action as the selected job changes. The job menu captures
one resolved URL for all actions, avoiding a different selected pane being
marked while a card's menu is open. Uncertain job resolution omits the actions.
Marks are manual and reversible; they are not proof of successful submission.

## Flow

1. The content script adds **Analyse with CV Fit Advisor** to Indeed's share menu
   and LinkedIn's job options menu, and handles **N** for the currently open or
   selected job. On results pages,
   **J** and **K** select rendered jobs, **H** hides the selection, and **U**
   reverses the latest navigation or hide. These actions do not intercept
   editable fields. Hiding is local to the current page and does not dismiss jobs
   on Indeed or LinkedIn. Hidden jobs reappear on page reload, and navigation and
   the bounded undo history reset, with the first **J** selecting the top job.
   While jobs are hidden, a DOM observer applies the hidden class to replacement
   cards after results rerender.
2. The extension service worker sends an authenticated request to the local
   bridge and uses short status checks while Codex automation runs.
3. The bridge opens a prepared Codex task through `codex://threads/new`.
4. The native Accessibility helper reads the visible composer settings and
   submits only when they already match 6.1 Sol, Medium, and Fast.
5. The bridge reports the result from its submission store, which is held in
   memory and persisted to disk after status changes.

Each accepted task receives a submission ID, and status checks use
that ID so multiple browser tabs cannot observe one another's results. Completed
records are bounded. Submission records are saved privately in
`~/Library/Application Support/Job Search Companion/submissions.json` and loaded
on startup. A restart marks unfinished `submitting` records as `interrupted`;
completed records retain their status. Check Codex before retrying an interrupted
task because submission may have happened before confirmation was saved.

## Extension structure

The content scripts are ordered by dependency in the manifest:

- `contracts/job-urls.js`, `contracts/blockers.js`, and `contracts/cv-fit-submissions.js` define shared URL, blocker-result, and CV task-status contracts, also consumed by Node through `shared/contracts.js`;
- `contracts/identifiers.js` supplies UUID validation for request and chat IDs;
- `contracts/shortcuts.js` defines keyboard bindings used by dispatch and menu hints;
- `contracts/messages.js` owns extension message names, and `blockers/client.js` sends checker requests for content scripts and settings;
- `extension-context.js` creates the content-page cross-script API, selectors, and UI configuration;
- `dom-visibility.js` provides rendered-element and viewport visibility checks, plus queries that include the root element;
- `job-url.js` parses and normalizes Indeed and LinkedIn page and job URLs;
- `job-resolution.js` resolves the selected job from URL, DOM, title, and page data;
- `job-navigation.js` owns results-page navigation, hiding, and undo state;
- `feedback.js` provides shared toast feedback independently of CV submission;
- `cv-fit-submission.js` owns bridge messaging, completion polling, and submission feedback;
- `job-mark-store.js` owns manual mark identity, persistence, pending writes, and storage synchronization;
- `page-decorations.js` batches page observation, scans cards and the selected heading once per render, and owns stable action/findings containers;
- `job-marks.js` decorates cards, job headers, and menu actions using that store;
- `shortcuts.js` dispatches the N/J/K/H/U keyboard actions and ignores editable targets, modifier keys, repeated key events and composition;
- `job-menu.js` creates and inserts the CV fit and job-record actions;
- `job-menu-observer.js` detects newly opened job menus;
- `blockers/indeed-description-store.js` observes captured descriptions and extracts inert text;
- `blockers/result-store.js` owns local findings and storage-change notifications;
- `blockers/renderer.js` presents badges, findings, and checker controls; and
- `blockers/checker.js` coordinates selection verification, dwell timing, and request polling.

The separate `blockers/indeed-description-capture.js` MAIN-world script observes descriptions before the isolated content scripts start. `service-worker.js` loads `bridge-config.js` and the installer-generated `local-config.js` for private bridge settings. Its shared JSON transport owns request headers and timeouts; CV and blocker handlers own authorization, endpoint selection, and response filtering. `options.html`, `options.js`, and `options.css` implement settings.

`cvFitSubmissions` is the content-page API for sending Codex tasks. The bridge's
`cv-fit-submission-store.js` persists their statuses; `cv-fit-submission-service.js` owns locking, execution and completed-history pruning. `analysis-routes.js` owns completion, listing and chat opening, with scoped completion dispatched before general-token authentication. The native helper publishes
its result enum in metadata; automated tests compare it with the shared status
contract.

Helpers that are used only inside one content script remain file-local. The
shared object contains only operations required by another script.

## Indeed layout workaround

On Indeed, the extension separates the server job-panel stylesheet from React
Native's client stylesheet at page startup. This works around Indeed clearing
the shared stylesheet during rendering, which otherwise clips the Apply button
and stacks the job-panel icons. It only removes the ID from Indeed's explicitly
marked server style element; Indeed generates the client CSS itself.

## Job resolution

Both sites are client-rendered applications. Indeed list pages can show a
selected job whose key is not in the address bar, so the extension captures
job-menu button context and resolves a unique key from the menu, nearby visible
job card, or page data. Title matches distinguish resolved, absent, ambiguous,
and incomplete scans. LinkedIn exposes the selected job through `currentJobId`,
detail links, and `job-card-component-ref-<id>` card identifiers. Every
uncertain result fails closed.

## Codex verification

The bridge opens this unsent prompt in the configured CV Fit workspace:

```text
$cv-fit-advisor
<Indeed or LinkedIn job link>
```

Before pressing Return, the helper:

1. identifies exactly one newly opened matching composer;
2. reads the model, effort, and speed from that composer's settings menu;
3. leaves the prompt ready for review if any setting differs or the menu cannot
   be read; and
4. otherwise submits and confirms that the prepared prompt cleared.

Submission confirmation inspects only the prepared composer's parent subtree,
requiring the prompt to disappear and exactly one newly cleared composer on
three consecutive checks. It does not traverse the conversation as responses
stream in. A timeout reports the last observed evidence without starting an
extra scan after the deadline.

Accessibility searches have deadlines and tree-size limits and fail closed on
ambiguous composers, menus, or settings. The helper does not use the clipboard
or mouse. It also holds an operating-system lock on a stable private lock file
for the entire automation operation, preventing a restarted bridge from
launching a second helper concurrently even while an installed helper binary is
being replaced.

## Installation

`shared/data-directory.js` defines the Node application-support root. Runtime and migration paths derive from it; the shell installer derives its managed paths from `DATA_DIRECTORY`.
`shared/filesystem.js` provides file reads, atomic writes, and symbolic-link
checks to both runtime storage and installation. The blocker private store reuses
its atomic writer while serializing captured JSON snapshots and creating private directories. `installer/file-transaction.js`
adds snapshot and rollback orchestration.

The installer stops the LaunchAgent before replacing managed artifacts, then
compiles and installs the helper with the extension token, the current checkout
path, and the configured workspace. It
records hashes for safe reinstall and
uninstall, and health checks verify the installed helper's hash and UI contract.
Each install also assigns a fresh bridge instance ID. Startup health checks
require that ID, so another process on the fixed port cannot be mistaken for
the newly started LaunchAgent.
Binary pre-install snapshots are stored as base64 so uninstall can restore them
without JSON changing their type.

Settings are read only through the visible composer, so installation and task
automation do not modify Codex workspace configuration.

Version 11 install states that still contain the retired global or workspace
configuration artifacts remain readable so reinstall or uninstall can restore
the user's pre-install content before dropping those artifacts.

## Blocker-checking internals

The Indeed-only MAIN-world `blockers/indeed-description-capture.js` observes descriptions
before the isolated scripts start. Both worlds load `contracts/job-urls.js` and `contracts/messages.js` so
job IDs and description messages use the same contracts. The isolated `blockers/checker.js` verifies
the selected description, waits for selection dwell, and polls check completion.
`blockers/result-store.js` owns extension-local result access, pruning, storage-change
notifications, and clearing through `jobSearchBlockerResults.createStore()`;
settings and the checker share that API. `blockers/renderer.js` reads results
through the store and presents findings without changing manual marks.

The selected full description must match the captured embedded or `/viewjob`
response description before checking. Initial selections use Indeed's
`autoOpenTwoPaneJobKey` with `autoOpenTwoPaneViewjobResponse`. Later fetch/XHR
responses expose `body.jobInfoWrapperModel.jobInfoModel.sanitizedJobDescription`.
The GraphQL layout exposes `data.viewjob.job.description.text`, paired with
`viewjob.key` / `job.key`; batched responses are supported. Classic and React
Native rendered descriptions are matched against an entire description subtree.
The observer preserves fetch observation across ordinary page reassignment.

In `bridge/blockers/`, `checker.js` owns scheduling, `result-cache.js` owns
persisted result retention, `account-fallback.js` owns account rotation,
`profile.js` parses explicitly named application and verified profile sources,
`cv-index.js` fingerprints current source CVs and maintains a private compact index of exact excerpts. Its `ensureCurrent()` method may extract files and call the model; `readCurrent()` reads a matching saved index without inference.
`chatgpt-response.js` parses completed JSON streams shared by checking and indexing. `inference.js` validates a streamed requirement inventory and derives findings from necessity/evidence classifications. Preferred requirements are excluded; missing evidence stays uncertain. Checker version 4 invalidates findings made while evaluating the prompt reductions. Specialist examples and candidate-requirement guidance are retained; only the repeated missing-evidence sentence was removed.
`chatgpt-accounts.js` exposes `openChatGPTAccountManager()` for persisted registrations, active-account selection, OAuth, and authenticated requests. `fallbackAccountIds()` returns eligible registration IDs. The checker has separate endpoints and status from CV Fit submissions.
`extension/contracts/blockers.js` defines result labels, version, retention,
record bounds, and retention eligibility for both runtimes.

OAuth attempts use fresh state, nonce and PKCE values, a loopback callback,
and ID-token signature, issuer, audience, expiry and nonce validation. Refreshes
are serialized in the bridge. Inference has no tools and treats job text as
untrusted evidence. Results require a completed response, valid JSON and outcome
fields, quoted description evidence, and known profile fact IDs.

### Scheduling and storage contracts

`checker.js` deduplicates work by cache key and prioritizes recent selections.
`cancelAllChecks()` invalidates queued and running work; `resetForAccountChange()`
also disables checking and clears model selection before account operations.
For timing, queue bounds, cancellation triggers, and account eligibility, see
[processing](blocker-checker.md#processing-and-findings) and
[fallback accounts](blocker-checker.md#fallback-accounts).

The bridge cache is keyed by Indeed job ID, description hash, profile hash,
checker version, and model. Retention and record bounds come from
`extension/contracts/blockers.js`. Private JSON files use atomic writes with
mode 0600; new directories use 0700. OAuth tokens never go to content scripts
or extension storage. See [cache and account data](blocker-checker.md#cache-and-account-data)
for retention, clearing, and sign-out behavior.

### Validation and processing tier

The local automated suite covers OAuth state/identity flow, protected storage, plan-compatible request shape, terminal SSE handling, evidence validation, cache invalidation, scheduling, and the bridge authentication boundary. Account-specific model admission and structured-output support are outside this automated coverage; see [limitations and validation](blocker-checker.md#limitations-and-validation).

Historical tier observation, documented 2026-10-08: an earlier plan-usage test
reported `service_tier: "default"` despite a GPT-6-Luna `priority` request. Its
test date and account were not recorded. This does not establish the current
processing tier; Fast processing remains unconfirmed.

See [checker setup, behaviour, account fallback, and limitations](blocker-checker.md)
for user-facing controls and connection constraints.

## Data migrations

ChatGPT storage converts the former `profiles` field to `accounts` once on opening.
Conflicting fields fail without changing credentials; runtime code uses only
`accounts`. Retired global/workspace artifacts remain readable so reinstall or
uninstall can restore pre-install configuration. See
[installation identity migration](setup.md#installation-identity-migration)
for migration and rollback instructions.

## Analysis completion and chat opening

`analysis-store.js` persists analysis requests separately from the bounded
submission history in private `analyses.json` storage. Each submission creates
a random completion token; only its hash is saved. The generated Codex prompt
contains a shell-quoted invocation of `scripts/complete-analysis.js`, which
reads the current `CODEX_THREAD_ID` and posts to that request’s completion
endpoint. This credential can complete only that job request and cannot read
records, open chats, or control the rest of the bridge. Repeating a successful
callback is idempotent; changing its chat ID is rejected.

`GET /analyses` returns the latest completed record for each platform job ID,
without callback credentials. A service-worker alarm synchronizes records
every 30 seconds, and visible pages request a sync on load or visibility
changes. Saved records use `analyzed-job:<platform>:<job-id>` storage keys.
`job-analyses.js` renders the card badge and detail action from these records.
An unfinished reanalysis preserves the existing completed result.

`POST /analyses/open` accepts a job URL, looks up its stored chat, and invokes
macOS `open` with `codex://threads/<thread-id>?hostId=local`. It never accepts
an arbitrary destination from a page. Listing and opening retain the normal
extension-origin and bridge-token checks; completion uses its scoped token
and the same origin restriction.

Completion callbacks require an exact CV-fit verdict. The completion helper
accepts it as a quoted third argument. It is validated, saved, and synchronized
with the analysis record. Repeating a callback with a different verdict is
rejected. Existing records without verdict metadata retain their links and
neutral blue appearance. Verdict colours use the shared analysis contract.
