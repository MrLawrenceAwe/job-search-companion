import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

import { helperContract } from "../../bridge/codex/helper-contract.js";
import { cvFitSettings } from "../../shared/cv-fit-settings.js";

const execFileAsync = promisify(execFile);

test("the LaunchAgent does not restart the bridge for source-file changes", async () => {
  const plist = await readFile(
    new URL("../../launchd/com.lawrenceawe.job-search-companion.plist", import.meta.url),
    "utf8",
  );

  assert.match(plist, /<string>__JSC_NODE_EXECUTABLE__<\/string>\s*<string>__JSC_BRIDGE_ROOT__\/bridge\/server\.js<\/string>/);
  assert.match(plist, /<key>WorkingDirectory<\/key>\s*<string>__JSC_BRIDGE_ROOT__<\/string>/);
  assert.match(plist, /<key>JSC_WORKSPACE<\/key>\s*<string>__JSC_WORKSPACE__<\/string>/);
  assert.match(plist, /<key>JSC_LOG_PATH<\/key>\s*<string>__JSC_LOG_PATH__<\/string>/);
  assert.match(plist, /<key>JSC_BRIDGE_INSTANCE_ID<\/key>\s*<string>__JSC_BRIDGE_INSTANCE_ID__<\/string>/);
  assert.doesNotMatch(plist, /--watch/);
  assert.doesNotMatch(plist, /\/tmp\/indeed-cv-fit-bridge/);
  assert.equal((plist.match(/<string>\/dev\/null<\/string>/g) || []).length, 2);
});

test("installation precompiles the Accessibility helper", async () => {
  const installScript = await readFile(
    new URL("../../scripts/manage-bridge.sh", import.meta.url),
    "utf8",
  );

  assert.match(
    installScript,
    /\/usr\/bin\/swiftc -O "\$ROOT\/bridge\/codex\/accessibility-helper"\/\*\.swift -o "\$helper_binary"/,
  );
  assert.match(installScript, /--accessibility-helper-source "\$helper_binary"/);
  assert.match(installScript, /--accessibility-helper-target "\$ACCESSIBILITY_HELPER"/);
  assert.doesNotMatch(installScript, /mv -f "\$helper_binary"/);
  assert.match(installScript, /ROOT=\$\(CDPATH= cd "\$\(dirname "\$0"\)\/\.\." && pwd -P\)/);
  assert.match(installScript, /--root-path "\$ROOT"/);
  assert.match(installScript, /--workspace-path "\$WORKSPACE_PATH"/);
  assert.match(installScript, /LOG_PATH="\$\{JSC_LOG_PATH:-\$DATA_DIRECTORY\/bridge\.log\}"/);
  assert.match(installScript, /--log-path "\$LOG_PATH"/);
  assert.match(installScript, /--instance-id "\$bridge_instance_id"/);
});

test("health verification rejects another bridge instance on the same port", async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "cv-fit-health-instance-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const fetchStubPath = join(fixtureRoot, "fetch-stub.mjs");
  await writeFile(fetchStubPath, `globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => JSON.parse(process.env.FAKE_HEALTH_BODY),
  });\n`);
  const packageMetadata = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const body = {
    ok: true,
    service: packageMetadata.name,
    version: packageMetadata.version,
    port: 48973,
    instanceId: "another-instance",
    accessibilityHelper: {
      ready: true,
      protocolVersion: helperContract.protocolVersion,
      contractVersion: helperContract.contractVersion,
      hashMatchesInstallState: true,
    },
    requiredSettings: cvFitSettings.map(({ category, label }) => ({ category, label })),
  };
  const runCheck = (instanceId) => execFileAsync(process.execPath, [
    "--import", fetchStubPath,
    fileURLToPath(new URL("../../scripts/check-health.js", import.meta.url)),
  ], {
    env: {
      ...process.env,
      JSC_BRIDGE_TOKEN: "test-token",
      JSC_BRIDGE_INSTANCE_ID: instanceId,
      FAKE_HEALTH_BODY: JSON.stringify(body),
    },
  });

  await assert.rejects(runCheck("new-instance"), /expected bridge instance new-instance/);
  await runCheck("another-instance");
});

test("reinstall stops the bridge before replacing its managed helper", async () => {
  const installScript = await readFile(
    new URL("../../scripts/manage-bridge.sh", import.meta.url),
    "utf8",
  );

  const stopOffset = installScript.indexOf("if stop_launch_agent; then", installScript.indexOf("install_bridge()"));
  const installOffset = installScript.indexOf('node "$ROOT/scripts/bridge-install-cli.js" install');
  assert.ok(stopOffset >= 0);
  assert.ok(installOffset >= 0);
  assert.ok(stopOffset < installOffset);
});

test("reinstall backs up every managed artifact before stopping the bridge", async () => {
  const installScript = await readFile(
    new URL("../../scripts/manage-bridge.sh", import.meta.url),
    "utf8",
  );
  const installStart = installScript.indexOf("install_bridge()");
  const backupOffset = installScript.indexOf("backup_current_installation", installStart);
  const stopOffset = installScript.indexOf("if stop_launch_agent; then", installStart);

  assert.ok(backupOffset > installStart);
  assert.ok(stopOffset > backupOffset);
  assert.match(installScript, /managed-artifact-paths/);
  assert.match(installScript, /restore_managed_file "\$artifact_path" "managed-\$artifact_name"/);
});

test("a failed replacement startup restores the prior installed artifacts", async () => {
  const installScript = await readFile(
    new URL("../../scripts/manage-bridge.sh", import.meta.url),
    "utf8",
  );

  const backupOffset = installScript.indexOf("backup_current_installation");
  const installOffset = installScript.indexOf('node "$ROOT/scripts/bridge-install-cli.js" install');
  const failedStartOffset = installScript.indexOf("if ! start_verified_launch_agent; then");
  const restoreOffset = installScript.indexOf("restore_current_installation", failedStartOffset);

  assert.ok(backupOffset >= 0);
  assert.ok(installOffset >= 0);
  assert.ok(failedStartOffset >= 0);
  assert.ok(restoreOffset > failedStartOffset);
  assert.ok(backupOffset < installOffset);
  assert.doesNotMatch(
    installScript.slice(failedStartOffset, restoreOffset + 200),
    /bridge-install-cli\.js" uninstall/,
  );
});

test("installation verifies the bridge health endpoint after launchd starts it", async () => {
  const installScript = await readFile(
    new URL("../../scripts/manage-bridge.sh", import.meta.url),
    "utf8",
  );

  assert.match(
    installScript,
    /start_verified_launch_agent\(\) \{\s*start_launch_agent\s*wait_for_bridge_health\s*\}/,
  );
  assert.match(
    installScript,
    /JSC_BRIDGE_INSTANCE_ID="\$bridge_instance_id" node "\$ROOT\/scripts\/check-health\.js" >\/dev\/null 2>&1/,
  );
  assert.match(
    installScript,
    /if ! start_verified_launch_agent; then/,
  );

  const healthCheck = await readFile(
    new URL("../../scripts/check-health.js", import.meta.url),
    "utf8",
  );
  assert.match(healthCheck, /const HEALTH_REQUEST_TIMEOUT_MS = 2_000;/);
  assert.match(healthCheck, /const requestAbortController = new AbortController\(\);/);
  assert.match(healthCheck, /signal: requestAbortController\.signal,/);
  assert.match(healthCheck, /\.finally\(\(\) => clearTimeout\(requestTimeout\)\)/);
});

test("a failed uninstall retries and restarts a LaunchAgent that was previously loaded", async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "cv-fit-uninstall-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));

  const binPath = join(fixtureRoot, "bin");
  const homePath = join(fixtureRoot, "home");
  const logPath = join(fixtureRoot, "launchctl.log");
  const plistPath = join(
    homePath,
    "Library/LaunchAgents/com.lawrenceawe.job-search-companion.plist",
  );
  await mkdir(binPath, { recursive: true });
  await mkdir(join(plistPath, ".."), { recursive: true });
  await writeFile(plistPath, "test plist\n");

  const launchctlPath = join(binPath, "launchctl");
  await writeFile(
    launchctlPath,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$LAUNCHCTL_LOG"\nif [ "$1" = bootstrap ] && [ ! -f "$BOOTSTRAP_SUCCEEDED" ]; then touch "$BOOTSTRAP_SUCCEEDED"; exit 1; fi\nexit 0\n`,
  );
  await chmod(launchctlPath, 0o755);

  const nodePath = join(binPath, "node");
  await writeFile(nodePath, "#!/bin/sh\nexit 1\n");
  await chmod(nodePath, 0o755);

  await assert.rejects(execFileAsync(
    "/bin/sh",
    [fileURLToPath(new URL("../../scripts/manage-bridge.sh", import.meta.url)), "uninstall"],
    {
      env: {
        ...process.env,
        HOME: homePath,
        LAUNCHCTL_LOG: logPath,
        BOOTSTRAP_SUCCEEDED: join(fixtureRoot, "bootstrap-succeeded"),
        PATH: `${binPath}:/usr/bin:/bin`,
      },
    },
  ));

  const commands = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.match(commands[0], /^print /);
  assert.match(commands[1], /^bootout /);
  assert.match(commands[2], /^bootstrap /);
  assert.match(commands[3], /^bootstrap /);
  assert.match(commands[4], /^enable /);
  assert.match(commands[5], /^kickstart -k /);
});
