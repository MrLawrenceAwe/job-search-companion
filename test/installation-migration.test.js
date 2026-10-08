import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { migrateInstallation } from "../installer/legacy-installation.js";
import { openChatGPTConnection } from "../bridge/blockers/chatgpt.js";

const fixture = async (t) => {
  const homePath = await mkdtemp(join(await realpath(tmpdir()), "jsc-migration-"));
  t.after(() => rm(homePath, { recursive: true, force: true }));
  const source = join(homePath, "Library/Application Support/Indeed CV Fit Bridge");
  const target = join(homePath, "Library/Application Support/Job Search Companion");
  await mkdir(join(source, "blockers"), { recursive: true, mode: 0o700 });
  return { homePath, source, target };
};

test("identity migration preserves private data and rewrites only moved artifact paths", async (t) => {
  const { homePath, source, target } = await fixture(t);
  const helper = Buffer.from([0, 255, 3]);
  await writeFile(join(source, "accessibility-helper"), helper, { mode: 0o700 });
  const state = {
    version: 11,
    artifacts: {
      accessibilityHelper: {
        path: join(source, "accessibility-helper"),
        previousContentBase64: "AP8=",
        installedHash: "hash",
      },
      launchAgent: {
        path: join(homePath, "Library/LaunchAgents/com.lawrenceawe.indeed-cv-fit-bridge.plist"),
      },
    },
  };
  await writeFile(join(source, "install-state.json"), JSON.stringify(state), { mode: 0o600 });
  const data = {
    "blockers/chatgpt.json": '{"credentials":"preserved"}',
    "blockers/cache.json": '{"results":{}}',
    "submissions.json": '{"submissions":[]}',
    "bridge.log": "prior log\n",
  };
  for (const [path, content] of Object.entries(data))
    await writeFile(join(source, path), content, { mode: 0o600 });
  await migrateInstallation({ homePath });
  await assert.rejects(stat(source), { code: "ENOENT" });
  assert.deepEqual(await readFile(join(target, "accessibility-helper")), helper);
  assert.equal((await stat(join(target, "accessibility-helper"))).mode & 0o777, 0o700);
  for (const [path, content] of Object.entries(data)) {
    assert.equal(await readFile(join(target, path), "utf8"), content);
    assert.equal((await stat(join(target, path))).mode & 0o777, 0o600);
  }
  const migrated = JSON.parse(await readFile(join(target, "install-state.json"), "utf8"));
  assert.equal(migrated.artifacts.accessibilityHelper.path, join(target, "accessibility-helper"));
  assert.equal(migrated.artifacts.accessibilityHelper.previousContentBase64, "AP8=");
  assert.equal(migrated.artifacts.launchAgent.path, state.artifacts.launchAgent.path);
  await migrateInstallation({ homePath });
});

test("identity migration refuses conflicting directories and symbolic links without changing data", async (t) => {
  const { homePath, source, target } = await fixture(t);
  await mkdir(target);
  await assert.rejects(migrateInstallation({ homePath }), /Both bridge data directories/);
  await rm(target, { recursive: true });
  await symlink(source, target);
  await assert.rejects(migrateInstallation({ homePath }), /symbolic links/);
  assert.ok(await stat(source));
});

test("account field migration preserves registrations and credentials and persists the current contract", async (t) => {
  const { source } = await fixture(t);
  const path = join(source, "blockers/chatgpt.json");
  const account = {
    id: "a",
    subject: "subscriber",
    clientId: "client-a",
    accessToken: "token",
    refreshToken: "refresh",
    scopes: ["chatgpt.tokens.use.direct"],
    expiresAt: Date.now() + 3600_000,
  };
  await writeFile(path, JSON.stringify({ hostId: "host", activeId: "a", profiles: [account] }));
  const auth = await openChatGPTConnection({ path });
  t.after(() => auth.close());
  assert.equal(auth.connectionStatus().planUsageEnabled, true);
  assert.equal(auth.connectionStatus().accounts[0].id, "a");
  const stored = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(stored.accounts, [account]);
  assert.equal(stored.activeId, "a");
  assert.equal(stored.hostId, "host");
  assert.equal(Object.hasOwn(stored, "profiles"), false);
});

test("conflicting account schemas are rejected without overwriting credentials", async (t) => {
  const { source } = await fixture(t);
  const path = join(source, "blockers/chatgpt.json");
  const content = JSON.stringify({ accounts: [], profiles: [{ accessToken: "preserve" }] });
  await writeFile(path, content);
  await assert.rejects(openChatGPTConnection({ path }), /Conflicting ChatGPT account stores/);
  assert.equal(await readFile(path, "utf8"), content);
});

for (const code of ["rate_limit_exceeded", "subscription_sharing_usage_limit_exceeded"]) {
  test(`ChatGPT error wording distinguishes ${code}`, async (t) => {
    const { source } = await fixture(t);
    const path = join(source, "blockers/chatgpt.json");
    await writeFile(
      path,
      JSON.stringify({
        activeId: "a",
        accounts: [
          {
            id: "a",
            accessToken: "token",
            scopes: ["chatgpt.tokens.use.direct"],
            expiresAt: Date.now() + 3600_000,
          },
        ],
      }),
    );
    const auth = await openChatGPTConnection({
      path,
      fetchImpl: async () => Response.json({ error: { code } }, { status: 429 }),
    });
    t.after(() => auth.close());
    await assert.rejects(auth.models(), (error) => {
      assert.equal(error.code, code);
      assert.match(
        error.message,
        code === "rate_limit_exceeded" ? /temporarily rate limited/ : /plan usage limit reached/,
      );
      return true;
    });
  });
}
