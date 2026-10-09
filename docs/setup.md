# Setup and removal

[Back to the project overview](../README.md)

## Install

### Prerequisites

- macOS with Chrome and the Codex desktop app installed.
- Node.js 22 or newer, with `node` and `npm` available in your terminal.
- Xcode Command Line Tools or Xcode, providing `/usr/bin/swiftc`. If the tools
  are missing, run `xcode-select --install` and finish installation before
  installing the bridge.
- A local Codex workspace with a skill named `cv-fit-advisor` available. This
  repository does not bundle that skill or any CV files. The bridge prepares
  `$cv-fit-advisor` followed by the selected job URL; the skill supplies the CV
  assessment instructions. Each prompt also includes the completion helper to save
  the analysed mark and current Codex chat ID. Configure its documents and instructions separately
  before using CV analysis.

Clone the repository into a stable folder of your choice, then run the commands
below from that folder. The installer records its location. Moving an unpacked
extension can affect its identity and saved records, so choose the folder before
loading it in Chrome.

Application marking and navigation only need the unpacked extension. Continue
with bridge installation when you want CV analysis or Indeed blocker checks.

### 1. Load the Chrome extension

Run `npm run build` from the repository directory to generate the MAIN-world
description capture bundle. Repeat this after source updates, before reloading
the extension.

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project's `extension` directory.
5. Copy the extension ID shown by Chrome.

### 2. Install and start the bridge

Install the bridge dependencies first:

```bash
npm ci
```

Choose a non-empty local token containing only ASCII letters, numbers, dots,
underscores and hyphens. Other characters are rejected by the installer. Replace
the example token and extension ID below, then run:

```bash
JSC_BRIDGE_TOKEN="your-local-token" \
JSC_EXTENSION_ORIGIN="chrome-extension://your-extension-id" \
./scripts/manage-bridge.sh install
```

The installer:

- starts the bridge automatically at login;
- writes the token to the ignored `extension/local-config.js`;
- installs the compiled Accessibility helper transactionally.

Reload the extension in Chrome after installation.

When updating an older installation, follow [installation identity migration](#installation-identity-migration) for data preservation, directory conflicts, and rollback details. Reinstall after updates to regenerate worker configuration, then reload the extension. macOS may require the moved helper's Accessibility permission to be granted again.

Before verifying task submission, open **System Settings → Privacy & Security →
Accessibility** and enable the installed helper. Use **+**, then **Command+Shift+G**
to select `~/Library/Application Support/Job Search Companion/accessibility-helper`.
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
JSC_BRIDGE_TOKEN="your-local-token" npm run check:health
```

## Indeed blocker checks

Open the extension toolbar action to connect ChatGPT, choose a model, and enable automatic checking. See [checker setup and behaviour](blocker-checker.md). The checker needs the Node bridge, but does not use the Accessibility helper or open Codex chats.

## Installation identity migration

Current installations accept only `JSC_*` environment variables, `com.lawrenceawe.job-search-companion`, and `~/Library/Application Support/Job Search Companion/`. The installer stops the former `com.lawrenceawe.indeed-cv-fit-bridge` service and moves its data directory before reinstalling. Managed artifact paths are rewritten, while credentials, findings, logs, submission history, file modes, and pre-install snapshots are retained. A failed replacement startup restores managed files and the original data directory, then attempts to restart the previously loaded service. Rollback restores installation artifacts, not repository source; if that service uses the retired environment contract, restore the previous checkout revision before running it. If both data directories exist, migration stops without merging or overwriting either.

## Run manually

After installation and Accessibility setup, stop the LaunchAgent before running
the bridge manually on the same port:

```bash
launchctl bootout "gui/$(id -u)/com.lawrenceawe.job-search-companion"
```

Then run:

```bash
JSC_BRIDGE_TOKEN="your-local-token" \
JSC_EXTENSION_ORIGIN="chrome-extension://your-extension-id" \
npm start
```

If you installed with a custom workspace or log path, also supply the same
`JSC_WORKSPACE` and `JSC_LOG_PATH` values when running
`npm start`. Manual startup reads environment variables; it does not load the
settings saved in the LaunchAgent. For example:

```bash
JSC_BRIDGE_TOKEN="your-local-token" \
JSC_EXTENSION_ORIGIN="chrome-extension://your-extension-id" \
JSC_WORKSPACE="/absolute/path/to/your/workspace" \
JSC_LOG_PATH="/absolute/path/to/your/bridge.log" \
npm start
```

Include only the optional variables you customised. The saved values are in the
`EnvironmentVariables` section of
`~/Library/LaunchAgents/com.lawrenceawe.job-search-companion.plist`.

The bridge listens only on `127.0.0.1:48973`.
Submission statuses are saved privately in
`~/Library/Application Support/Job Search Companion/submissions.json`. After a
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

- `JSC_BRIDGE_TOKEN`: token required by local bridge requests.
- `JSC_EXTENSION_ORIGIN`: allowed Chrome extension origin.

Optional environment variables:

- `JSC_WORKSPACE`: Codex workspace. Default: `$HOME/CV Fit Advisor`.
  Set it when installing; the installer writes that resolved path into the
  LaunchAgent. Supply it again for manual startup if you use a custom workspace.
- `JSC_LOG_PATH`: private rotating bridge log. Set it when running
  `install`; the chosen path is saved in the LaunchAgent. Re-run `install` to
  change it later. Supply it again for manual startup if you use a custom log path.

The native helper reads the visible composer's settings and automatically sends
only when they are already **6.1 Sol**, **Medium**, and **Fast**. Otherwise it
leaves the prepared prompt unsent for review.

Codex also reads workspace defaults from `CV Fit Advisor/.codex/config.toml`.
Set that workspace's `model` to `gpt-6.1-sol`, `model_reasoning_effort` to
`medium`, and `service_tier` to `priority` so new drafts open with the settings
the bridge requires. Workspace defaults can override the global Codex default.

### Diagnostic path overrides

For isolated automated checks or manual diagnostics, `JSC_INSTALL_STATE_PATH`
selects the install-state file and `JSC_ACCESSIBILITY_HELPER_PATH` selects the
compiled helper. These overrides are read by the bridge process; the installer
continues to manage the standard paths. Supply them explicitly when needed.
