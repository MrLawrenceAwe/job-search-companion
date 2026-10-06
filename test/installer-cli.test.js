import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "../scripts/install-state-cli.js";

test("CLI parsing converts kebab-case flags to option names", () => {
  assert.deepEqual(parseArguments([
    "install",
    "--state-path",
    "/tmp/state",
    "--extension-config-path",
    "/tmp/extension-config",
    "--allowed-extension-origin",
    "chrome-extension://example",
  ]), {
    command: "install",
    options: {
      statePath: "/tmp/state",
      extensionConfigPath: "/tmp/extension-config",
      allowedExtensionOrigin: "chrome-extension://example",
    },
  });
});

test("CLI parsing accepts a retired-artifact listing request", () => {
  assert.deepEqual(parseArguments([
    "retired-artifact-paths",
    "--state-path",
    "/tmp/state",
  ]), {
    command: "retired-artifact-paths",
    options: { statePath: "/tmp/state" },
  });
});
