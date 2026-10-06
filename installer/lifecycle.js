import { readFile, rm, rmdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

import {
  assertNoSymbolicLinkPaths,
  atomicWrite,
  readOptionalFile,
  runFileTransaction,
} from "./file-transaction.js";
import { sha256 } from "../shared/sha256.js";
import { ensureArtifactsUnchanged, readInstallState, STATE_VERSION } from "./install-state.js";
import { bridgeAddress } from "../bridge/address.js";

const escapeXml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const renderLaunchAgent = async (options) => (await readFile(options.plistSource, "utf8"))
  .replaceAll("__INDEED_CV_FIT_BRIDGE_ROOT__", escapeXml(options.rootPath))
  .replaceAll("__INDEED_CV_FIT_WORKSPACE__", escapeXml(options.workspacePath))
  .replaceAll("__INDEED_CV_FIT_LOG_PATH__", escapeXml(options.logPath))
  .replaceAll("__INDEED_CV_FIT_BRIDGE_TOKEN__", escapeXml(options.token))
  .replaceAll("__INDEED_CV_FIT_EXTENSION_ORIGIN__", escapeXml(options.allowedExtensionOrigin))
  .replaceAll("__INDEED_CV_FIT_BRIDGE_INSTANCE_ID__", escapeXml(options.instanceId));

const prepareArtifact = async ({
  path,
  installedContent,
  installedMode,
  priorArtifact,
  binary = false,
}) => {
  const hasPriorArtifact = priorArtifact !== undefined && priorArtifact !== null;
  return {
    path,
    previousContent: hasPriorArtifact
      ? priorArtifact.previousContent
      : await readOptionalFile(path, binary ? null : "utf8"),
    previousMode: hasPriorArtifact
      ? priorArtifact.previousMode
      : await stat(path).then((stats) => stats.mode & 0o777, () => null),
    installedHash: sha256(installedContent),
    installedContent,
    installedMode,
    ...(binary ? { binary: true } : {}),
  };
};

const planRetiredArtifact = async (artifact) => {
  if (!artifact) {
    return null;
  }
  const currentContent = await readOptionalFile(artifact.path, artifact.binary ? null : "utf8");
  if (currentContent === null || sha256(currentContent) !== artifact.installedHash) {
    throw new Error(`Installed file changed while preparing reinstall: ${artifact.path}`);
  }
  return artifact.previousContent === null
    ? { action: "remove", path: artifact.path, binary: artifact.binary === true }
    : {
        action: "write",
        path: artifact.path,
        content: artifact.previousContent,
        mode: artifact.previousMode,
        binary: artifact.binary === true,
      };
};

const applyFilePlan = async (plan, { removeFile, writeFileAtomically }) => {
  if (plan.action === "remove") {
    await removeFile(plan.path, { force: true });
  } else if (plan.action === "write") {
    await writeFileAtomically(plan.path, plan.content, plan.mode);
  }
};

const serializeArtifact = (artifact) => ({
  path: artifact.path,
  previousMode: artifact.previousMode,
  installedHash: artifact.installedHash,
  ...(artifact.binary
    ? {
        binary: true,
        previousContentBase64: artifact.previousContent === null
          ? null
          : artifact.previousContent.toString("base64"),
      }
    : { previousContent: artifact.previousContent }),
});

export const install = async (options, dependencies = {}) => {
  if (typeof options.instanceId !== "string" || !options.instanceId.trim()) {
    throw new Error("A bridge instance ID is required for installation");
  }
  const writeFileAtomically = dependencies.atomicWrite ?? atomicWrite;
  const removeFile = dependencies.rm ?? rm;
  const priorState = await readInstallState(options.statePath, { optional: true });
  await assertNoSymbolicLinkPaths([
    options.statePath,
    options.extensionConfigPath,
    options.plistTarget,
    options.accessibilityHelperTarget,
    ...Object.values(priorState?.artifacts ?? {}).filter(Boolean).map((artifact) => artifact.path),
  ]);
  await ensureArtifactsUnchanged(priorState);

  const extensionContent = `(() => {\n  Object.assign(globalThis.cvFitBridge.protocol, {\n    bridgeOrigin: ${JSON.stringify(bridgeAddress.origin)},\n    bridgeToken: ${JSON.stringify(options.token)},\n  });\n})();\n`;
  const accessibilityHelperContent = await readFile(options.accessibilityHelperSource);

  const artifactMoved = (artifact, targetPath) => artifact && artifact.path !== targetPath;
  const artifactSpecs = [
    {
      name: "extensionConfig",
      path: options.extensionConfigPath,
      installedContent: extensionContent,
      installedMode: 0o600,
      priorArtifact: artifactMoved(
        priorState?.artifacts.extensionConfig,
        options.extensionConfigPath,
      ) ? null : priorState?.artifacts.extensionConfig,
    },
    {
      name: "launchAgent",
      path: options.plistTarget,
      installedContent: await renderLaunchAgent(options),
      installedMode: 0o600,
      priorArtifact: artifactMoved(
        priorState?.artifacts.launchAgent,
        options.plistTarget,
      ) ? null : priorState?.artifacts.launchAgent,
    },
    {
      name: "accessibilityHelper",
      path: options.accessibilityHelperTarget,
      installedContent: accessibilityHelperContent,
      installedMode: 0o700,
      priorArtifact: artifactMoved(
        priorState?.artifacts.accessibilityHelper,
        options.accessibilityHelperTarget,
      ) ? null : priorState?.artifacts.accessibilityHelper,
      binary: true,
    },
  ];
  const artifacts = Object.fromEntries(await Promise.all(artifactSpecs.map(async ({ name, ...spec }) => [
    name,
    await prepareArtifact(spec),
  ])));
  const retiredArtifacts = (await Promise.all([
    planRetiredArtifact(priorState?.artifacts.globalConfig),
    planRetiredArtifact(priorState?.artifacts.workspaceConfig),
    ...artifactSpecs.map(({ name, path }) => {
      const priorArtifact = priorState?.artifacts[name];
      return artifactMoved(priorArtifact, path)
        ? planRetiredArtifact(priorArtifact)
        : null;
    }),
  ])).filter(Boolean);
  const state = {
    version: STATE_VERSION,
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [
      name,
      serializeArtifact(artifact),
    ])),
  };

  const changedPaths = [
    ...Object.values(artifacts).map((artifact) => artifact.path),
    ...retiredArtifacts.map((plan) => plan.path),
    options.statePath,
  ];
  const binaryPaths = new Set([
    ...Object.values(artifacts).filter((artifact) => artifact.binary).map((artifact) => artifact.path),
    ...retiredArtifacts.filter((plan) => plan.binary).map((plan) => plan.path),
  ]);
  await runFileTransaction({
    paths: changedPaths,
    binaryPaths,
    failureMessage: "Installation failed and rollback was incomplete",
    action: async () => {
      for (const artifact of Object.values(artifacts)) {
        await writeFileAtomically(
          artifact.path,
          artifact.installedContent,
          artifact.installedMode,
        );
      }
      for (const plan of retiredArtifacts) {
        await applyFilePlan(plan, { removeFile, writeFileAtomically });
      }
      await writeFileAtomically(options.statePath, `${JSON.stringify(state, null, 2)}\n`, 0o600);
    },
  });
};

const planArtifactRestore = async (artifact, warnings) => {
  const currentContent = await readOptionalFile(artifact.path, artifact.binary ? null : "utf8");
  if (currentContent === null) {
    return artifact.previousContent === null
      ? { path: artifact.path, action: "none" }
      : { path: artifact.path, action: "write", content: artifact.previousContent, mode: artifact.previousMode };
  }
  if (sha256(currentContent) !== artifact.installedHash) {
    warnings.push(`${artifact.path} was changed after installation`);
    return { path: artifact.path, action: "none" };
  }
  return artifact.previousContent === null
    ? { path: artifact.path, action: "remove" }
    : { path: artifact.path, action: "write", content: artifact.previousContent, mode: artifact.previousMode };
};

export const uninstall = async (options, dependencies = {}) => {
  const writeFileAtomically = dependencies.atomicWrite ?? atomicWrite;
  const removeFile = dependencies.rm ?? rm;
  const state = await readInstallState(options.statePath);
  await assertNoSymbolicLinkPaths([
    options.statePath,
    ...Object.values(state.artifacts).map((artifact) => artifact.path),
  ]);

  const warnings = [];
  const restorePlans = await Promise.all(
    Object.values(state.artifacts).map((artifact) => planArtifactRestore(artifact, warnings)),
  );
  if (warnings.length > 0) {
    throw new Error(`Installed files were preserved because they changed after installation:\n${warnings.join("\n")}`);
  }

  const changedPlans = restorePlans.filter((plan) => plan.action !== "none");
  const binaryPaths = new Set(
    Object.values(state.artifacts).filter((artifact) => artifact.binary).map((artifact) => artifact.path),
  );
  await runFileTransaction({
    paths: [...changedPlans.map((plan) => plan.path), options.statePath],
    binaryPaths,
    failureMessage: "Uninstallation failed and rollback was incomplete",
    action: async () => {
      for (const plan of changedPlans) {
        await applyFilePlan(plan, { removeFile, writeFileAtomically });
      }
      await removeFile(options.statePath, { force: true });
    },
  });
  await rmdir(dirname(options.statePath)).catch(() => {});
};
