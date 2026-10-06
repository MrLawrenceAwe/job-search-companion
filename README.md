# Job Search Companion

[![CI](https://github.com/MrLawrenceAwe/job-search-companion/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MrLawrenceAwe/job-search-companion/actions/workflows/ci.yml)

A Chrome extension for browsing Indeed and LinkedIn, remembering applications,
and sending selected jobs to a local Codex workspace for CV fit checks.

**Stack:** JavaScript, Node.js, Chrome Manifest V3, Swift and macOS Accessibility.

![Application marks and job menu in the synthetic preview](docs/images/applied-jobs-preview.jpg)

*Preview uses sample jobs and separate local demo storage. CV analysis is disabled.*

## What it does

- Adds **Mark as applied** and **Unmark as applied** to supported job menus and
  detail headers, with a green **✓ Applied** badge on result cards.
- Keeps application marks across page refreshes and Chrome restarts, and updates
  open tabs together. Platform job IDs identify records across tracking URLs.
- Provides **J/K** to navigate rendered results, **H** to hide a result on the
  current page, and **U** to undo navigation or hiding. Shortcuts ignore editable
  fields; hidden results return after reload.
- Adds **Analyse with CV Fit Advisor** and the **N** shortcut to prepare a CV fit
  task through a local service and a Swift Accessibility helper.

Application marks are manual local records. After applying on an employer's
website, mark its listing yourself; this does not update Indeed or LinkedIn's
application history or submit an application.

## Try the synthetic preview

No job-board account, CV, Codex installation or bridge is needed for the preview.
From the repository directory:

```sh
python3 -m http.server 48974 --bind 127.0.0.1
```

Open [the local preview](http://127.0.0.1:48974/test-support/applied-jobs-preview.html).
Select a sample job, open its menu and mark it as applied. Refresh or use
**Re-render results** to see the saved badge restored. The preview uses the
production content scripts with mock Chrome APIs; CV analysis stays disabled.
Stop the server with **Ctrl+C** when finished.

## Engineering highlights

- **Dynamic page handling:** DOM observers restore controls after job-board
  rerenders. Job resolution omits actions when the selected listing is ambiguous.
- **Local persistence:** separate per-job writes prevent unrelated application
  marks from overwriting each other; storage events synchronize open tabs.
- **Bounded task automation:** an authenticated loopback service invokes a Swift
  helper that checks the visible composer and required settings before submitting.
  Ambiguous UI state leaves the prepared prompt unsent.
- **Installation and recovery:** transactional file replacement, managed-file
  hashes, bridge instance checks and persisted submission states support failed
  installs, restarts and safe removal.

See [architecture and design](docs/design.md) for module boundaries and task flow.

## Install

Load `extension/` through Chrome's **Load unpacked** control for application
marking and browsing shortcuts. CV analysis additionally requires macOS, Node.js
22+, Xcode Command Line Tools, Codex, Accessibility permission and a configured
`cv-fit-advisor` skill. The skill and CV files are not included in this repository.

Follow [setup, configuration and removal](docs/setup.md) for the bridge, extension
identity, token, workspace and permissions. This is an independent personal
project, not affiliated with Indeed, LinkedIn or OpenAI.

## Tests and CI

Requires macOS, Node.js 22+ and Xcode Command Line Tools. There are no npm package
dependencies to install.

```sh
npm test
```

This type-checks the Swift helper and runs Node's built-in test runner. Tests use
synthetic jobs, mock browser APIs and temporary installation fixtures. They cover
job resolution, application persistence, navigation, HTTP authentication,
submission recovery and installation transactions. CI runs the same command on
macOS for pushes and pull requests using Node.js 22 and 24.

The suite does not prove compatibility with every live job-board layout or Codex
version. Real Accessibility permissions and end-to-end task submission need a
manual check on the target Mac; see [the setup guide](docs/setup.md#3-verify).

## Privacy and limitations

Application marks stay in this Chrome profile's extension storage. Removing the
extension clears them. Job-board layout changes can break integrations; only
rendered results are available to the navigation shortcuts.

CV analysis sends the selected job URL to `127.0.0.1:48973`, then prepares a task
in your configured Codex workspace. CV handling follows that workspace's skill
and Codex account configuration. The bridge stores submission status and rotating
logs locally; it does not make applications on your behalf.
