import { readFile } from "node:fs/promises";

import { sha256 } from "../../shared/sha256.js";
import { config } from "../config.js";
import { runCommand } from "../run-command.js";

export const readAccessibilityHelperHealth = async () => {
  try {
    const [stateText, binaryContent] = await Promise.all([
      readFile(config.storage.installStatePath, "utf8"),
      readFile(config.codex.accessibilityHelperPath),
    ]);
    const state = JSON.parse(stateText);
    const expectedHash = state.artifacts?.accessibilityHelper?.installedHash;
    const actualHash = sha256(binaryContent);
    if (expectedHash !== actualHash) {
      return {
        ready: false,
        hashMatchesInstallState: false,
        error: "Accessibility helper hash does not match install state",
      };
    }

    const metadataText = await runCommand(
      config.codex.accessibilityHelperPath,
      ["metadata"],
      { timeoutMs: 1000 },
    );
    const metadata = JSON.parse(metadataText);
    const ready = metadata.protocolVersion === config.codex.accessibilityProtocolVersion
      && metadata.contractVersion === config.codex.accessibilityContractVersion;
    return {
      ready,
      protocolVersion: metadata.protocolVersion,
      contractVersion: metadata.contractVersion,
      hashMatchesInstallState: true,
    };
  } catch (error) {
    return {
      ready: false,
      error: error.message,
    };
  }
};
