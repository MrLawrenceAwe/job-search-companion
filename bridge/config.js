import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { cvFitSettings } from "../shared/cv-fit-settings.js";
import { bridgeAddress } from "./address.js";
import { helperContract } from "./codex/helper-contract.js";

const packageMetadata = createRequire(import.meta.url)("../package.json");
const workspacePath = resolve(
  process.env.JSC_WORKSPACE || join(homedir(), "CV Fit Advisor"),
);

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
};

export const config = Object.freeze({
  bridge: Object.freeze({
    name: packageMetadata.name,
    version: packageMetadata.version,
    host: bridgeAddress.host,
    port: bridgeAddress.port,
    token: requiredEnv("JSC_BRIDGE_TOKEN"),
    allowedExtensionOrigin: requiredEnv("JSC_EXTENSION_ORIGIN"),
    instanceId: process.env.JSC_BRIDGE_INSTANCE_ID || null,
  }),
  cvFit: Object.freeze({
    workspacePath,
    settings: cvFitSettings,
  }),
  blockers: Object.freeze({
    directory: join(homedir(), "Library/Application Support/Job Search Companion/blockers"),
    profilePaths: [
      join(homedir(), "Job Hunting/profile.md"),
      join(homedir(), ".codex/skills/apply-to-jobs/references/profile.md"),
    ],
  }),
  codex: Object.freeze({
    bundleId: "com.openai.codex",
    accessibilityProtocolVersion: helperContract.protocolVersion,
    accessibilityContractVersion: helperContract.contractVersion,
    accessibilityHelperPath: process.env.CODEX_ACCESSIBILITY_HELPER_PATH
      || join(homedir(), "Library/Application Support/Job Search Companion/accessibility-helper"),
    composerReadyTimeoutMs: 8000,
    settingsTimeoutMs: 8000,
    submissionTimeoutMs: 5000,
  }),
  storage: Object.freeze({
    installStatePath: process.env.JSC_INSTALL_STATE_PATH
      || join(homedir(), "Library/Application Support/Job Search Companion/install-state.json"),
    logPath: process.env.JSC_LOG_PATH
      || join(homedir(), "Library/Application Support/Job Search Companion/bridge.log"),
    submissionsPath: join(homedir(), "Library/Application Support/Job Search Companion/submissions.json"),
  }),
});
