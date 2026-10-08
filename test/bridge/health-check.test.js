import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { helperContract } from "../../bridge/codex/helper-contract.js";
import { cvFitSettings } from "../../shared/cv-fit-settings.js";

const execFileAsync = promisify(execFile);

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
