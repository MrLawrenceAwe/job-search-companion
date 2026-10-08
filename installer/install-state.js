import { readOptionalFile } from "./file-transaction.js";
import { sha256 } from "../shared/sha256.js";

export const STATE_VERSION = 11;
const ARTIFACT_NAMES = ["accessibilityHelper", "extensionConfig", "launchAgent"];
const RETIRED_ARTIFACT_NAMES = ["globalConfig", "workspaceConfig"];
const SUPPORTED_ARTIFACT_NAMES = new Set([
  ...ARTIFACT_NAMES,
  ...RETIRED_ARTIFACT_NAMES,
]);

const hydrateArtifact = (artifact) => {
  if (!artifact?.binary) {
    return artifact;
  }

  const { previousContentBase64, ...rest } = artifact;
  return {
    ...rest,
    previousContent: previousContentBase64 === null
      ? null
      : Buffer.from(previousContentBase64, "base64"),
  };
};

export const readInstallState = async (path, { optional = false } = {}) => {
  const text = await readOptionalFile(path);
  if (text === null) {
    if (optional) {
      return null;
    }
    throw new Error(`Install state not found: ${path}`);
  }
  const state = JSON.parse(text);
  if (state.version !== STATE_VERSION) {
    throw new Error(`Unsupported install state version: ${state.version}`);
  }
  const artifactNames = Object.keys(state.artifacts).sort();
  const isCurrentArtifactSet = artifactNames.length === ARTIFACT_NAMES.length
    && artifactNames.every((name, index) => name === ARTIFACT_NAMES[index]);
  const hasRetiredArtifact = artifactNames.some(
    (name) => RETIRED_ARTIFACT_NAMES.includes(name),
  );
  if (artifactNames.some((name) => !SUPPORTED_ARTIFACT_NAMES.has(name))
      || (!isCurrentArtifactSet && !hasRetiredArtifact)) {
    throw new Error(`Unsupported install state artifacts: ${artifactNames.join(", ")}`);
  }
  return {
    ...state,
    artifacts: Object.fromEntries(
      Object.entries(state.artifacts).map(([name, artifact]) => [
        name,
        hydrateArtifact(artifact),
      ]),
    ),
  };
};

export const ensureArtifactsUnchanged = async (state) => {
  if (!state) {
    return;
  }
  const changedPaths = [];
  const managedArtifacts = Object.values(state.artifacts);
  for (const artifact of managedArtifacts) {
    const content = await readOptionalFile(artifact.path, artifact.binary ? null : "utf8");
    if (content === null || sha256(content) !== artifact.installedHash) {
      changedPaths.push(artifact.path);
    }
  }
  if (changedPaths.length > 0) {
    throw new Error(`Installed files changed after installation; reinstall was cancelled:\n${changedPaths.join("\n")}`);
  }
};

export const readManagedArtifactPaths = async (path) => {
  const state = await readInstallState(path, { optional: true });
  return Object.entries(state?.artifacts || {}).map(([name, artifact]) => ({ name, path: artifact.path }));
};
