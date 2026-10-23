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
that ID so multiple browser tabs cannot observe one another's results. Terminal
submission records are bounded. Submission records are saved privately in
`~/Library/Application Support/Job Search Companion/submissions.json` and loaded
on startup. A restart marks unfinished `submitting` records as `interrupted`;
other submission records retain their status. Check Codex before retrying an interrupted
task because submission may have happened before confirmation was saved.

## Extension structure

The content scripts are ordered by dependency in the manifest:

- `contracts/job-urls.js`, `contracts/blockers.js`, and `contracts/cv-fit-submissions.js` define shared URL, blocker-result, and CV submission-status contracts, also consumed by Node through `shared/contracts.js`;
- `contracts/inference-settings.js` defines model reasoning capabilities and request options for checking and CV indexing;
- `contracts/job-storage-keys.js` builds and parses persisted job keys for content scripts,
  worker services, and Node without changing saved key values;
- `contracts/job-marks.js` shares manual-mark timestamp fields and record validation between badges and list exclusions;
- `contracts/indeed-availability.js` shares listing statuses, record validation and cache freshness between the content script and worker;
- `contracts/cv-fit-settings.js` shares the required Codex settings between submission
  automation and the draft-review message;
- `contracts/identifiers.js` supplies UUID validation for request and chat IDs;
- `contracts/shortcuts.js` defines keyboard bindings used by dispatch and menu hints;
- `contracts/messages.js` owns extension message names, and `blockers/client.js` sends checker requests for content scripts and settings;
- `extension-context.js` creates the content-page cross-script API, selectors, UI configuration, and shared job-title normalisation;
- `dom-visibility.js` provides rendered-element and viewport visibility checks, plus queries that include the root element;
- `job-url.js` parses and normalizes Indeed and LinkedIn page and job URLs;
- `job-resolution.js` resolves the selected job from URL, DOM, title, and page data, and shares rendered detail-heading lookup with page decorations and manual marks;
- `job-navigation.js` owns results-page navigation, hiding, and undo state;
- `feedback.js` provides shared toast feedback independently of CV submission;
- `cv-fit-submission.js` owns bridge messaging, completion polling, and submission feedback;
- `job-mark-store.js` owns manual mark identity, persistence, pending writes, and storage synchronization;
- `page-decorations.js` batches page observation, builds a shared snapshot of cards and the selected heading for renderers, owns stable action/findings containers, and lets the blocker checker subscribe to page changes through the same observer and navigation listeners;
- `job-marks.js` decorates cards, job headers, and menu actions using that store;
- `job-analysis-store.js` owns the shared completed-analysis records, validation, and storage notifications;
- `job-analyses.js` renders analysis actions from that store;
- `indeed-to-apply-renderer.js` renders the **To apply** panel from supplied jobs
  and application-sync status;
- `indeed-to-apply.js` tracks Indeed exclusions, captures listing metadata, and
  refreshes missing metadata separately from selecting eligible analysed jobs;
- `shortcuts.js` dispatches the N/J/K/H/U keyboard actions and ignores editable targets, modifier keys, repeated key events and composition;
- `job-menu.js` creates and inserts the CV fit and job-record actions;
- `job-menu-observer.js` detects newly opened job menus;
- `blockers/indeed-description-store.js` observes captured descriptions and extracts inert text;
- `blockers/result-store.js` owns local findings and storage-change notifications;
- `blockers/renderer.js` registers the page renderer and uses local helpers for finding rows, challenge forms, and override controls; and
- `blockers/checker.js` coordinates selection verification, dwell timing, and request polling.

The separate `blockers/indeed-description-capture.js` MAIN-world script observes descriptions before the isolated content scripts start. `service-worker.js` loads `bridge-config.js` and the installer-generated `local-config.js` for private bridge settings. It registers feature handlers from `worker/`. `worker/bridge-client.js` owns bridge
request headers and timeouts; `worker/cv-fit.js`, `worker/blockers.js`, and
`worker/analyses.js` own their message boundaries. `worker/indeed-applications.js`
synchronizes application history. `worker/indeed-listings.js` shares in-flight
listing reads between title and availability requests while keeping their caches
separate; `worker/indeed-listing-parser.js` extracts both fields from one JSON-LD
traversal. `worker/senders.js` shares job-site sender validation. `options.html`, `options.js`, and `options.css` implement settings.

`cvFitSubmissions` is the content-page API for sending Codex tasks. The bridge's
`cv-fit-submission-store.js` persists their statuses; `cv-fit-submission-service.js` owns locking, execution and terminal-submission history pruning. `analysis-routes.js` owns completion, listing and chat opening, with scoped completion dispatched before general-token authentication. The native helper publishes
its result enum in metadata; automated tests compare it with the shared status
contract.

Helpers that are used only inside one content script remain file-local. The
shared object contains only operations required by another script.

`contracts/job-urls.js` owns platform/job-ID extraction through `identityFromUrl()`.
The content-page adapters accept supported results-page selections; the bridge
submission endpoint requires a job-detail URL. Mark and analysis storage keys
retain their existing prefixes and platform/job IDs so saved records survive
refactoring. Service-worker analysis and blocker handlers share sender URL checks
while retaining their separate allowed sites and actions.

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

The bridge opens an unsent prompt in the configured CV Fit workspace. Its assessment portion is:

```text
$cv-fit-advisor
<Indeed or LinkedIn job link>
```

The prompt also includes a job-specific completion command, its scoped credential,
and allowed verdicts. See [analysis completion and chat opening](#analysis-completion-and-chat-opening)
for the callback contract and `bridge/codex/deep-link.js` for prompt generation.

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
through the store and registers its renderer without changing manual marks. The
checker requests deferred rendering through `pageDecorations.schedule()`.
Each result store exposes a `ready` promise for its initial snapshot. Storage
notifications apply after that snapshot so a late read cannot replace newer
findings or resurrect a removed result. Saves and clearing also await readiness.

The selected full description must match the captured embedded or `/viewjob`
response description before checking. Initial selections use Indeed's
`autoOpenTwoPaneJobKey` with `autoOpenTwoPaneViewjobResponse`. Later fetch/XHR
responses expose `body.jobInfoWrapperModel.jobInfoModel.sanitizedJobDescription`.
The GraphQL layout exposes `data.viewjob.job.description.text`, paired with
`viewjob.key` / `job.key`; batched responses are supported. Classic and React
Native rendered descriptions are matched against an entire description subtree.
The observer preserves fetch observation across ordinary page reassignment.

In `bridge/blockers/`, `checker.js` owns scheduling, `result-cache.js` owns
persisted result retention, and `account-fallback.js` owns account rotation.
`profile.js` reads relevant facts from the application and application-skill
profile sources and integrates accepted corrections. These are supplied evidence,
including self-reported corrections, rather than independent verification.

`evidence.js` assembles profile facts and indexed CV excerpts with one shared
identity and hashing operation, also used by evaluation scripts. Its provider
exposes `readCurrent()` for existing evidence and `prepareCurrent()` for work that
may convert CV files, call the model, and save a refreshed index.
`cancelPreparation()` aborts that preparation independently of saved-evidence reads.
Evidence status also reports whether the CV index is current, pending a refresh,
or disabled, separately from the evidence hash.

`cv-index.js` fingerprints current source CVs and maintains a private compact index
of exact excerpts. Its `ensureCurrent()` method may extract files and call the
model; `readCurrent()` reads a matching saved index without inference. Source hashing
and conversion use up to three concurrent workers, preserving sorted source order
and passage IDs. Failure or cancellation drains active workers before a retry;
source content checks and final collection verification still apply.

`chatgpt-response.js` parses completed JSON streams shared by checking and indexing.
`inference.js` validates the requirement inventory, exact description quotes, and
known evidence IDs before deriving findings. Each request binds evidence references
to the supplied fact IDs, requires references for supported/incompatible/conflicting
evidence, and forbids references for missing evidence. The structured schema requires prose
for findings and null explanations for other entries. See [requirement policy](#requirement-policy) for classification rules.
`inference-prompts.js` owns instructions, `inference-schemas.js` owns structured
response shapes, and `inference-validation.js` owns finding, correction, and
challenge validation. `inference.js` constructs requests and allows one corrective request for an invalid quote, requirement entry, or inconsistent challenge decision.

`chatgpt-accounts.js` exposes `openChatGPTAccountManager()` for registrations,
active-account selection, OAuth, and authenticated requests. `fallbackAccountIds()`
returns eligible registration IDs. The checker has separate endpoints and status
from CV Fit submissions.

`extension/contracts/blockers.js` defines result labels, version, retention,
record bounds, suggested-challenge word and character limits, and retention
eligibility for both runtimes. Inference prompts, schemas and validation reuse
those limits. `extension/contracts/inference-settings.js` owns application
policies for model reasoning selection and processing tier, plus inference request
options, shared by settings, requirement inference, and CV indexing. The internal `blocker` result name covers both
confirmed shortfalls and missing or conflicting evidence; the UI uses **Potential
blocker**, and explanations retain the distinction. Combined profile and CV
evidence uses `evidence`, `evidenceHash`, `evidenceFactIds`, and `evidenceFacts`;
profile terminology is reserved for editable profile sources. The version in
`extension/contracts/blockers.js` determines which disposable check results are
retained; older results are discarded without field migrations. Manual marks and
completed analyses retain their storage contracts.

OAuth attempts use fresh state, nonce and PKCE values, a loopback callback,
and ID-token signature, issuer, audience, expiry and nonce validation. Refreshes
are serialized in the bridge. Inference has no tools and treats job text as
untrusted evidence. Results require a completed response, valid JSON and outcome
fields, quoted description evidence, and known profile fact IDs.

### Scheduling and storage contracts

`checker.js` deduplicates work by cache key and prioritizes recent selections.
`cancelAllChecks()` invalidates queued and running work; `resetForAccountChange()`
also disables checking and clears model selection before account operations.
For account eligibility, see [fallback accounts](blocker-checker.md#fallback-accounts).

Automatic checks begin after a 1.5-second dwell in a visible tab. One model request runs at a time. Recent eligible selections take precedence over waiting jobs, with at most ten waiting checks. Already-running checks finish when selection changes; turning checks off, clearing findings, shutdown, and account changes cancel work. Identical checks share a task across tabs. Requests time out after 90 seconds. Result polling waits in the bridge for completion (up to eight seconds per poll), so finished checks appear without an additional polling delay. Disconnected tabs release their wait without cancelling the shared check. A completed response with a non-verbatim requirement quote or invalid requirement fields gets one corrective request within the same 90-second deadline. Feedback identifies the rejected entry and validation problem, including empty explanations, invalid evidence references and oversized suggested challenges. The complete inventory is validated again; a second validation failure shows a specific checker error and says blocker status is unknown. Other failed checks require an explicit retry; transient failures do not retry automatically or switch billing.

The bridge cache is keyed by Indeed job ID, description hash, evidence hash,
checker version, model, and reasoning effort. Challenges also enter the in-flight
deduplication key; saved results use the ordinary key without a challenge.
Retention and record bounds come from
`extension/contracts/blockers.js`. Private JSON files use atomic writes with
mode 0600; new directories use 0700. OAuth tokens never go to content scripts
or extension storage. See [cache and account data](blocker-checker.md#cache-and-account-data)
for retention, clearing, and sign-out behavior.

### CV extraction and reuse

CV source reads and extraction honour the check's cancellation signal and 90-second
deadline. Cancellation stops active PDF/Word converters and prevents remaining
CVs from being extracted or submitted for indexing.
CV source hashing and conversion each run with at most three files in flight.
Evidence stays in sorted source order regardless of conversion completion order.
A failed conversion cancels sibling work and waits for it to stop before a retry.
Within a bridge session, extracted CV text is reused by source path and content
hash. Editing a CV converts that file again; unchanged files reuse their text
when refreshing the index, changing the indexing model, or retrying a failed
index request. Source files are still read and hashed on each freshness check,
and the complete collection is verified again before saving an index. This reuse
does not change the evidence sent to the model or skip index inference.

### Requirement policy

The model inventories candidate requirements across prose and requirement sections.
The bridge validates each quoted advert excerpt and its evidence IDs, then derives
findings only from mandatory requirements. Preferences, unclear requirements,
ordinary duties, personality traits and generic soft skills produce no findings.
Mixed statements are split so a trait or work arrangement cannot hide a concrete
eligibility prerequisite. Specialist sector and compliance experience must be
established by evidence; transferable administration skills do not establish it.

Mandatory eligibility requirements produce findings when evidence is missing,
conflicting or incompatible. Mandatory work arrangements produce findings only
when a profile fact explicitly conflicts with them. Availability for one location
or pattern does not imply refusal of every other arrangement. Unspecified job
logistics do not create candidate requirements. Application questions alone do
not establish a required answer; citizenship and current location do not establish
continuous recent residence.

The schema requires non-empty explanations and suggested challenges for findings,
and null values for other entries. Every entry retains its quote, classifications
and evidence IDs. The local validator checks quotes and IDs but cannot guarantee that the model found
or correctly classified every requirement. Findings use the internal `blocker`
kind and the **Potential blocker** label; their explanation distinguishes missing
or conflicting evidence from an established incompatibility.

The inference API accepts one optional `challenge`. Its reusable factual correction
is validated against editable profile facts; CV excerpts cannot be replaced.
The `blockerChallenge` input and `candidateClarification` use the single `CH1` ID.
See `inference-prompts.js` for the full policy and examples,
`inference-schemas.js` for response shapes, and `inference-validation.js` for
local checks. The inference tests cover the classification combinations and
specialist, personal-quality, work-arrangement and residency cases.

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
`job-analysis-store.js` reads and validates these records once for the content page.
`job-analyses.js` renders the card badge and detail action from this shared store;
`indeed-to-apply.js` uses it to select jobs for the **To apply** list, displayed
by `indeed-to-apply-renderer.js`.
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
neutral blue appearance. Verdict labels, colours and **To apply** eligibility use
the shared analysis contract.

## Test organisation

`npm test` builds the extension, type-checks the Swift helper and runs Node tests
with synthetic jobs, mock browser APIs and temporary installation fixtures.
Suites mirror source boundaries under `test/extension/`, `test/bridge/`,
`test/installer/`, and `test/shared/`. `test-support/` owns VM/JSDOM script loaders,
shared fixtures, and separate event-loop draining and timed-wait helpers. Both
wait helpers take an options object with an attempt limit and failure message,
and fail if the condition remains unmet; timed waits also accept an interval.
Tests cover resolution, mark persistence, navigation, HTTP authentication,
submission recovery and installation transactions. CI runs on macOS with Node 22
and 24. Real Accessibility permission and task submission require the
[manual setup check](setup.md#3-verify).
