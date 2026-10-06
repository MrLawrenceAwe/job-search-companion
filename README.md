# Job Search Companion

Browse jobs, track applications and run CV fit checks on Indeed and LinkedIn.
The Chrome extension adds **Mark as applied** and **Analyse with CV Fit Advisor**
to job menus. CV fit checks go through the local service to Codex.

## Applied-job tracking

After completing an application on an employer website, return to its Indeed or
LinkedIn listing and choose **Mark as applied** from the job menu. The job detail
header also has this action on supported layouts. Applied jobs show a green
**✓ Applied** badge on result cards. Choose **Unmark as applied** to undo a mark.

Marks include the recorded date and persist across page refreshes and Chrome
restarts. Open tabs update together, and the same platform job ID is recognised
even when the link has different tracking parameters or a different country
subdomain. These are your local records, not updates to Indeed's or LinkedIn's
account history. Applications on other websites are not marked automatically.

Records stay in this Chrome profile's extension storage and do not require the
local service to be running. Removing the extension clears them; clearing a
website's cookies does not. Reload the existing unpacked extension in
`chrome://extensions`, then refresh job pages to pick up version 0.11.0.

The checkout is `/Users/lawrenceawe/Job Hunting/Job Search Companion`.
The installed service and installation records use that path. A hidden symbolic
link at the former checkout path keeps the already-loaded Chrome extension
working with its existing identity and saved application marks. Keep that link
while Chrome is registered to the former extension path. The LaunchAgent
identifier and Application Support directory remain stable to preserve saved
submission history and the helper's macOS Accessibility permission.

## Install

### Prerequisites

- macOS with Chrome and the Codex desktop app installed.
- Node.js 18 or newer, with `node` and `npm` available in your terminal.
- Xcode Command Line Tools or Xcode, providing `/usr/bin/swiftc`. If the tools
  are missing, run `xcode-select --install` and finish installation before
  installing the bridge.
- The CV Fit Advisor skill available in Codex and the configured workspace
  ready to open.

Run the commands below from this project's directory.

### 1. Load the Chrome extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project's `extension` directory.
5. Copy the extension ID shown by Chrome.

### 2. Install and start the bridge

Choose a non-empty local token containing only ASCII letters, numbers, dots,
underscores and hyphens. Other characters are rejected by the installer. Replace
the example token and extension ID below, then run:

```bash
INDEED_CV_FIT_BRIDGE_TOKEN="your-local-token" \
INDEED_CV_FIT_EXTENSION_ORIGIN="chrome-extension://your-extension-id" \
./scripts/manage-bridge.sh install
```

The installer:

- starts the bridge automatically at login;
- writes the token to the ignored `extension/local-config.js`;
- installs the compiled Accessibility helper transactionally.

Reload the extension in Chrome after installation.

Before verifying task submission, open **System Settings → Privacy & Security →
Accessibility** and enable the installed helper. Use **+**, then **Command+Shift+G**
to select `~/Library/Application Support/Indeed CV Fit Bridge/accessibility-helper`.
If macOS requests permission for the terminal or Node process used to launch the
helper, enable that entry too. The helper requires Accessibility permission to
inspect Codex and submit tasks; a successful bridge health check alone does not
confirm this permission. If permission stops working after reinstalling the
helper, remove and add its Accessibility entry again, then retry verification.

### 3. Verify

Open an Indeed or LinkedIn job, then either:

- press **N**; or
- open its job menu and choose **Analyse with CV Fit Advisor**. On LinkedIn,
  this is under the job detail pane’s **More options** button.

On an Indeed or LinkedIn results page, press **J** to move to the next rendered
job and **K** to move to the previous one. Press **H** to hide the selected job
locally on the current page; this does not dismiss the job in Indeed or LinkedIn.
Selection moves to the next available result, or the previous one when there is
no next result. Press **U** to undo the most recent **J**, **K**, or **H** action.
Shortcuts are ignored while focus is in a
text field, select control, or editable region. After a page refresh, hidden jobs
reappear and navigation and undo history reset, so the first **J** selects the
top rendered job.

To check the bridge directly:

```bash
INDEED_CV_FIT_BRIDGE_TOKEN="your-local-token" npm run test:health
```

## Run manually

After installation and Accessibility setup, stop the LaunchAgent before running
the bridge manually on the same port:

```bash
launchctl bootout "gui/$(id -u)/com.lawrenceawe.indeed-cv-fit-bridge"
```

Then run:

```bash
INDEED_CV_FIT_BRIDGE_TOKEN="your-local-token" \
INDEED_CV_FIT_EXTENSION_ORIGIN="chrome-extension://your-extension-id" \
npm start
```

If you installed with a custom workspace or log path, also supply the same
`INDEED_CV_FIT_WORKSPACE` and `INDEED_CV_FIT_LOG_PATH` values when running
`npm start`. Manual startup reads environment variables; it does not load the
settings saved in the LaunchAgent. For example:

```bash
INDEED_CV_FIT_BRIDGE_TOKEN="your-local-token" \
INDEED_CV_FIT_EXTENSION_ORIGIN="chrome-extension://your-extension-id" \
INDEED_CV_FIT_WORKSPACE="/absolute/path/to/your/workspace" \
INDEED_CV_FIT_LOG_PATH="/absolute/path/to/your/bridge.log" \
npm start
```

Include only the optional variables you customised. The saved values are in the
`EnvironmentVariables` section of
`~/Library/LaunchAgents/com.lawrenceawe.indeed-cv-fit-bridge.plist`.

The bridge listens only on `127.0.0.1:48973`.
Submission statuses are saved privately in
`~/Library/Application Support/Indeed CV Fit Bridge/submissions.json`. After a
bridge restart, a task that was still running is reported as interrupted; check
Codex before submitting that job again.

## Remove

```bash
./scripts/manage-bridge.sh uninstall
```

Uninstall restores every managed file to its pre-install contents. If any
managed file changed after installation, uninstall preserves all files instead
of overwriting the change.

## Configuration

Required environment variables:

- `INDEED_CV_FIT_BRIDGE_TOKEN`: token required by local bridge requests.
- `INDEED_CV_FIT_EXTENSION_ORIGIN`: allowed Chrome extension origin.

Optional environment variables:

- `INDEED_CV_FIT_WORKSPACE`: Codex workspace. Default: `$HOME/CV Fit Advisor`.
  Set it when installing; the installer writes that resolved path into the
  LaunchAgent. Supply it again for manual startup if you use a custom workspace.
- `INDEED_CV_FIT_LOG_PATH`: private rotating bridge log. Set it when running
  `install`; the chosen path is saved in the LaunchAgent. Re-run `install` to
  change it later. Supply it again for manual startup if you use a custom log path.

The native helper reads the visible composer's settings and automatically sends
only when they are already **6.1 Sol**, **Medium**, and **Fast**. Otherwise it
leaves the prepared prompt unsent for review.

Codex also reads workspace defaults from `CV Fit Advisor/.codex/config.toml`.
Set that workspace's `model` to `gpt-6.1-sol`, `model_reasoning_effort` to
`medium`, and `service_tier` to `priority` so new drafts open with the settings
the bridge requires. Workspace defaults can override the global Codex default.

## Development

```bash
npm test
```

For a browser preview of application marking, serve the checkout locally with
`python3 -m http.server 48974 --bind 127.0.0.1` and open
`http://127.0.0.1:48974/test-support/applied-jobs-preview.html`. It uses sample
jobs and separate demo storage; it exercises the production content scripts
without submitting applications or running Codex tasks. Stop the preview
server when finished.

See [docs/design.md](docs/design.md) for architecture and Accessibility
verification.
