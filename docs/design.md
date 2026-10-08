# Design

## Job records

The installer records the chosen checkout location. Keep the unpacked extension
in a stable directory so its identity and local job records remain
available. See [setup and removal](setup.md) before installing the bridge.
`job-marks.js` stores each manual applied or unsuitable mark separately in
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

- `contracts/job-urls.js` and `contracts/blockers.js` define shared URL and result contracts, also consumed by Node through `shared/contracts.js`;
- `extension-context.js` creates the small shared cross-script API and configuration;
- `dom-visibility.js` provides rendered-element and viewport visibility checks, plus queries that include the root element;
- `job-url.js` parses and normalizes Indeed and LinkedIn page and job URLs;
- `job-resolution.js` resolves the selected job from URL, DOM, title, and page data;
- `job-navigation.js` owns results-page navigation, hiding, and undo state;
- `feedback.js` provides shared toast feedback independently of CV submission;
- `submission.js` owns bridge messaging, completion polling, and submission feedback;
- `job-marks.js` persists manual applied and unsuitable records and decorates cards, job headers and menu actions;
- `shortcuts.js` dispatches the N/J/K/H/U keyboard actions and ignores editable targets, modifier keys, repeated key events and composition;
- `job-menu.js` creates and inserts the CV fit and job-record actions;
- `job-menu-observer.js` detects newly opened job menus;
- `blocker-descriptions.js` observes captured descriptions and extracts inert text;
- `blocker-records.js` owns local findings and storage-change notifications;
- `blocker-renderer.js` presents badges, findings, and checker controls; and
- `blocker-checker.js` coordinates selection verification, dwell timing, and request polling.

The separate `indeed-description-capture.js` MAIN-world script observes descriptions before the isolated content scripts start. `service-worker.js` authenticates bridge requests, and `options.html`, `options.js`, and `options.css` implement settings.

Helpers that are used only inside one content script remain file-local. The
shared object contains only operations required by another script.

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

`shared/filesystem.js` provides file reads, atomic writes, and symbolic-link
checks to both runtime storage and installation. `installer/file-transaction.js`
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

The Indeed-only MAIN-world `indeed-description-capture.js` observes descriptions
before the isolated scripts start. Both worlds load `contracts/job-urls.js` so
job IDs use the same platform rules. The isolated `blocker-checker.js` verifies
the selected description, waits for selection dwell, and polls check completion.
`blocker-records.js` owns extension-local result access, pruning, storage-change
notifications, and clearing through `jobSearchBlockerRecords.createStore()`;
settings and the checker share that API. `blocker-renderer.js` reads results
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
and `inference.js` validates streamed findings against supplied evidence.
`chatgpt.js` exposes the persisted ChatGPT connection manager and its connection
status. The checker has separate endpoints and status from CV Fit submissions.
`extension/contracts/blockers.js` defines result labels, version, retention,
record bounds, and retention eligibility for both runtimes.

OAuth attempts use fresh state, nonce and PKCE values, a loopback callback,
and ID-token signature, issuer, audience, expiry and nonce validation. Refreshes
are serialized in the bridge. Inference has no tools and treats job text as
untrusted evidence. Results require a completed response, valid JSON and outcome
fields, quoted description evidence, and known profile fact IDs.

See [checker setup, behaviour, account fallback, and limitations](blocker-checker.md)
for user-facing controls and connection constraints.

## Installation identity migration

Current installations use `JSC_*` environment variables, `com.lawrenceawe.job-search-companion`, and `~/Library/Application Support/Job Search Companion/`. The installer stops the former `com.lawrenceawe.indeed-cv-fit-bridge` service and moves its data directory before reinstalling. Managed artifact paths are rewritten, while credentials, findings, logs, submission history, file modes, and pre-install snapshots are retained. A failed replacement startup restores managed files and the original data directory, then attempts to restart the previously loaded service. Rollback restores installation artifacts, not repository source; if that service uses the retired environment contract, restore the previous checkout revision before running it. If both data directories exist, migration stops without merging or overwriting either.

ChatGPT storage converts the former `profiles` field to `accounts` once on opening. Conflicting old and new fields fail without changing credentials. The runtime uses only the current field. The retired global/workspace configuration restoration remains necessary to avoid losing the user's pre-install configuration.
