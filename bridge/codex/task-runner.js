import { cvFitSubmissionContract } from "../../shared/contracts.js";
import { config } from "../config.js";
import { runCommand } from "../run-command.js";
import { readAccessibilityHelperHealth } from "./helper-health.js";
import { createTaskDeepLink } from "./deep-link.js";

const SETTINGS_MENU_TIMEOUT_PHASES = 3;
const COMPOSER_TIMEOUT_PHASES = 3;
const HELPER_COMMAND_GRACE_MS = 8000;

export const accessibilityHelperTimeoutMs = (config.codex.composerReadyTimeoutMs * COMPOSER_TIMEOUT_PHASES)
  + (config.codex.settingsTimeoutMs * (
    SETTINGS_MENU_TIMEOUT_PHASES
  ))
  + config.codex.submissionTimeoutMs
  + HELPER_COMMAND_GRACE_MS;

export const createAccessibilityHelperArguments = ({ jobUrl, completion }) => [
  "auto-submit-if-configured",
  JSON.stringify({
    jobUrl,
    newTaskUrl: createTaskDeepLink({ jobUrl, completion }),
    bundleIdentifier: config.codex.bundleId,
    settings: config.cvFit.settings.map(({ category, label, match }) => ({
      category,
      expectedValue: label,
      match,
    })),
    timeouts: {
      composerMs: config.codex.composerReadyTimeoutMs,
      settingsMs: config.codex.settingsTimeoutMs,
      submissionMs: config.codex.submissionTimeoutMs,
    },
  }),
];

export const submitCvFitTask = async ({ jobUrl, completion }) => {
  const helperHealth = await readAccessibilityHelperHealth();
  if (!helperHealth.ready) {
    throw new Error(`Accessibility helper is not current: ${helperHealth.error || JSON.stringify(helperHealth)}`);
  }
  const result = await runCommand(config.codex.accessibilityHelperPath, createAccessibilityHelperArguments({ jobUrl, completion }), {
    timeoutMs: accessibilityHelperTimeoutMs,
  });
  const status = result.trim();
  if (!cvFitSubmissionContract.helperResults.includes(status)) {
    throw new Error(`Accessibility helper returned an invalid result: ${status || "empty output"}`);
  }
  return { status };
};
