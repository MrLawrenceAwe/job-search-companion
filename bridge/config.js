import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { cvFitSettings } from "../shared/cv-fit-settings.js";
import { bridgeAddress } from "./address.js";
import { helperContract } from "./codex/helper-contract.js";

const packageMetadata = createRequire(import.meta.url)("../package.json");
const workspacePath = resolve(
  process.env.INDEED_CV_FIT_WORKSPACE || join(homedir(), "CV Fit Advisor"),
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
    token: requiredEnv("INDEED_CV_FIT_BRIDGE_TOKEN"),
    allowedExtensionOrigin: requiredEnv("INDEED_CV_FIT_EXTENSION_ORIGIN"),
    instanceId: process.env.INDEED_CV_FIT_BRIDGE_INSTANCE_ID || null,
  }),
  cvFit: Object.freeze({
    workspacePath,
    settings: cvFitSettings,
  }),
  codex: Object.freeze({
    bundleId: "com.openai.codex",
    accessibilityProtocolVersion: helperContract.protocolVersion,
    accessibilityContractVersion: helperContract.contractVersion,
    accessibilityHelperPath: process.env.CODEX_ACCESSIBILITY_HELPER_PATH
      || join(homedir(), "Library/Application Support/Indeed CV Fit Bridge/accessibility-helper"),
    composerReadyTimeoutMs: 8000,
    settingsTimeoutMs: 8000,
    submissionTimeoutMs: 5000,
  }),
  storage: Object.freeze({
    installStatePath: process.env.INDEED_CV_FIT_INSTALL_STATE_PATH
      || join(homedir(), "Library/Application Support/Indeed CV Fit Bridge/install-state.json"),
    logPath: process.env.INDEED_CV_FIT_LOG_PATH
      || join(homedir(), "Library/Application Support/Indeed CV Fit Bridge/bridge.log"),
    submissionsPath: join(homedir(), "Library/Application Support/Indeed CV Fit Bridge/submissions.json"),
  }),
});
