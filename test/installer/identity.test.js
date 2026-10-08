import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, readFile, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import test from "node:test";
import { install } from "../../installer/lifecycle.js";

const run = promisify(execFile);
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
for (const healthSucceeds of [true, false]) {
  test(`identity reinstall ${healthSucceeds ? "replaces the old service" : "rolls back data and the old service after startup failure"}`, async (t) => {
    const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-identity-install-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const checkout = join(directory, "checkout");
    const homePath = join(directory, "home");
    const bin = join(directory, "bin");
    await mkdir(checkout);
    await mkdir(bin);
    for (const path of [
      "scripts",
      "installer",
      "shared",
      "extension",
      "launchd",
      "bridge/codex/accessibility-helper",
      "bridge/address.js",
      "package.json",
    ]) {
      await cp(new URL(`../../${path}`, import.meta.url), join(checkout, path), {
        recursive: true,
        filter: (source) => !source.endsWith("local-config.js"),
      });
    }
    const source = join(homePath, "Library/Application Support/Indeed CV Fit Bridge");
    const target = join(homePath, "Library/Application Support/Job Search Companion");
    await mkdir(join(source, "blockers"), { recursive: true });
    const helperSource = join(directory, "original-helper");
    await writeFile(helperSource, Buffer.from([0, 255, 1]));
    const legacyPlist = join(
      homePath,
      "Library/LaunchAgents/com.lawrenceawe.indeed-cv-fit-bridge.plist",
    );
    await install({
      statePath: join(source, "install-state.json"),
      extensionConfigPath: join(checkout, "extension/local-config.js"),
      plistSource: join(checkout, "launchd/com.lawrenceawe.job-search-companion.plist"),
      plistTarget: legacyPlist,
      accessibilityHelperSource: helperSource,
      accessibilityHelperTarget: join(source, "accessibility-helper"),
      rootPath: checkout,
      workspacePath: join(directory, "workspace"),
      logPath: join(source, "bridge.log"),
      token: "original-token",
      allowedExtensionOrigin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      instanceId: "old-instance",
    });
    const before = await readFile(join(source, "install-state.json"));
    const previousConfig = await readFile(join(checkout, "extension/local-config.js"));
    await writeFile(
      join(source, "blockers/chatgpt.json"),
      '{"profiles":[{"refreshToken":"preserved"}]}',
      { mode: 0o600 },
    );
    const oldLoaded = join(directory, "old-loaded");
    const newLoaded = join(directory, "new-loaded");
    const calls = join(directory, "launchctl.log");
    await writeFile(oldLoaded, "loaded");
    await writeFile(
      join(bin, "launchctl"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$LAUNCHCTL_LOG"
case "$*" in
  *com.lawrenceawe.indeed-cv-fit-bridge*) flag="$OLD_LOADED" ;;
  *) flag="$NEW_LOADED" ;;
esac
case "$1" in
  print) [ -f "$flag" ] ;;
  bootout) rm -f "$flag" ;;
  bootstrap) touch "$flag" ;;
  *) exit 0 ;;
esac
`,
      { mode: 0o755 },
    );
    await writeFile(
      join(bin, "node"),
      `#!/bin/sh
case "$1" in */check-health.js)
  ${healthSucceeds ? ":" : `printf '%s' '{"accounts":[{"refreshToken":"preserved"}]}' > "$HOME/Library/Application Support/Job Search Companion/blockers/chatgpt.json"`}
  exit ${healthSucceeds ? 0 : 1} ;; esac
exec '${process.execPath.replaceAll("'", "'\\''")}' "$@"
`,
      { mode: 0o755 },
    );
    const execution = run("/bin/sh", [join(checkout, "scripts/manage-bridge.sh"), "install"], {
      env: {
        ...process.env,
        HOME: homePath,
        PATH: `${bin}:/usr/bin:/bin`,
        JSC_BRIDGE_TOKEN: "replacement-token",
        JSC_EXTENSION_ORIGIN: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        OLD_LOADED: oldLoaded,
        NEW_LOADED: newLoaded,
        LAUNCHCTL_LOG: calls,
      },
    });
    if (healthSucceeds) {
      await execution;
      assert.equal(await exists(source), false);
      assert.equal(await exists(legacyPlist), false);
      assert.equal(await exists(oldLoaded), false);
      assert.equal(await exists(newLoaded), true);
      assert.match(
        await readFile(join(checkout, "extension/local-config.js"), "utf8"),
        /jobSearchBridgeConfig/,
      );
      assert.equal(
        await readFile(join(target, "blockers/chatgpt.json"), "utf8"),
        '{"profiles":[{"refreshToken":"preserved"}]}',
      );
    } else {
      await assert.rejects(execution);
      assert.equal(await exists(target), false);
      assert.equal(await exists(source), true);
      assert.equal(await exists(oldLoaded), true);
      assert.equal(await exists(newLoaded), false);
      assert.equal(await exists(legacyPlist), true);
      assert.deepEqual(await readFile(join(source, "install-state.json")), before);
      assert.deepEqual(await readFile(join(checkout, "extension/local-config.js")), previousConfig);
      assert.equal(
        await readFile(join(source, "blockers/chatgpt.json"), "utf8"),
        '{"profiles":[{"refreshToken":"preserved"}]}',
      );
    }
    const commands = await readFile(calls, "utf8");
    assert.ok(commands.indexOf("bootout gui/") < commands.indexOf("bootstrap gui/"));
  });
}
