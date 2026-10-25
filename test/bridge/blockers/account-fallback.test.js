import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBlockerChecker } from "../../../bridge/blockers/checker.js";
import { openChatGPTAccountManager } from "../../../bridge/blockers/chatgpt-accounts.js";
import { runWithAccountFallback } from "../../../bridge/blockers/account-fallback.js";
import { drainEventLoopUntil, waitUntil } from "../../../test-support/async.js";

const profile = { hash: "verified", facts: [{ id: "F1", text: "Provisional licence" }], sources: [] };
const job = (id = "first1111") => ({ jobUrl: `https://uk.indeed.com/viewjob?jk=${id}`, description: "You must hold a full UK driving licence to visit customer sites in this role." });
const result = { outcome: "no_blockers_found", findings: [] };
const quota = () => Object.assign(new Error("Usage limit reached"), { status: 429, code: "subscription_sharing_usage_limit_exceeded" });
const fixture = async (t, infer, models = async () => [{ slug: "test" }]) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-fallback-"));
  let activeId = "a";
  const selected = [];
  const chatgpt = {
    connectionStatus: () => ({ activeId, planUsageEnabled: true, accounts: [
      { id: "a", label: "primary@example.test" },
      { id: "b", label: "fallback@example.test · Registration 1" },
      { id: "c", label: "third@example.test" },
    ] }),
    fallbackAccountIds: () => ["b", "c"],
    select: async (id) => { selected.push(id); activeId = id; },
    models: () => models(activeId), close() {},
  };
  const checker = await openBlockerChecker({ directory, chatgpt, evidenceProvider: { readCurrent: async () => profile, prepareCurrent: async () => profile }, infer });
  t.after(async () => { checker.close(); await rm(directory, { recursive: true, force: true }); });
  await checker.configure({ enabled: true, model: "test", accountFallback: true });
  return { checker, chatgpt, selected };
};
const settle = async (checker, task) => {
  await waitUntil(() => ["completed", "failed", "cancelled"].includes(checker.get(task.id).status), {
    attempts: 400, message: "Expected fallback check to finish",
  });
  return checker.get(task.id);
};

for (const scenario of ["index limit", "missing index model", "index and check limits"]) {
  test(`CV refresh uses account fallback for ${scenario}`, async (t) => {
    const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-index-fallback-"));
    let activeId = "a";
    const selected = [], calls = [];
    const chatgpt = {
      connectionStatus: () => ({ activeId, planUsageEnabled: true }),
      fallbackAccountIds: () => ["b", "c"],
      select: async (id) => { selected.push(id); activeId = id; },
      models: async () => [{ slug: "test" }, ...(scenario === "missing index model" && activeId === "b" ? [] : [{ slug: "index" }])],
      request: async (_endpoint, options) => {
        const body = JSON.parse(options.body);
        calls.push({ stage: "index", account: activeId, model: body.model });
        if (activeId === "a") throw quota();
        return new Response(`data: ${JSON.stringify({ type: "response.completed", response: {
          status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ passageIds: ["P1"] }) }] }],
        } })}\n\n`);
      },
      close() {},
    };
    await writeFile(join(directory, "profile.md"), "## Personal Constraints\n- Provisional driving licence.\n");
    await writeFile(join(directory, "Lawrence_Awe_Test_CV.txt"), "PROFILE\nCustomer service experience with responsibilities for enquiries, records, scheduling and resolving customer issues in a sample organisation.\n");
    const checker = await openBlockerChecker({
      directory, cvDirectory: directory, chatgpt,
      profileSources: [{ kind: "application", path: join(directory, "profile.md") }],
      infer: async ({ model }) => {
        calls.push({ stage: "check", account: activeId, model });
        if (scenario === "index and check limits" && activeId === "b") throw quota();
        return result;
      },
    });
    t.after(async () => { checker.close(); await rm(directory, { recursive: true, force: true }); });
    await checker.configure({ enabled: true, model: "test", indexModel: "index", accountFallback: true });
    const task = await checker.start(job());
    assert.equal((await settle(checker, task)).status, "completed");
    assert.deepEqual(selected, scenario === "index limit" ? ["b"] : ["b", "c"]);
    assert.deepEqual(calls.filter((call) => call.stage === "index").map((call) => call.account), ["a", scenario === "missing index model" ? "c" : "b"]);
    assert.ok(calls.every((call) => call.model === (call.stage === "index" ? "index" : "test")));
    assert.equal((await checker.status()).pausedReason, null);
  });
}

test("confirmed usage exhaustion retries the same check and queued jobs continue on the fallback", async (t) => {
  const calls = []; let release;
  const { checker, chatgpt, selected } = await fixture(t, async ({ chatgpt, model, description }) => {
    calls.push({ account: chatgpt.connectionStatus().activeId, model, description });
    if (calls.length === 1) { await new Promise((resolve) => { release = resolve; }); throw quota(); }
    return result;
  });
  const first = await checker.start(job());
  const queued = await checker.start(job("second111"));
  release();
  assert.equal((await settle(checker, first)).status, "completed");
  assert.equal((await settle(checker, queued)).status, "completed");
  assert.deepEqual(calls.map((c) => c.account), ["a", "b", "b"]);
  assert.ok(calls.every((c) => c.model === "test" && c.description === job().description));
  assert.deepEqual(selected, ["b"]);
  assert.equal(chatgpt.connectionStatus().activeId, "b");
  assert.equal((await checker.status()).pausedReason, null);
});

test("all exhausted accounts are tried once then checks pause without caching an outcome", async (t) => {
  const calls = [];
  const { checker } = await fixture(t, async ({ chatgpt }) => { calls.push(chatgpt.connectionStatus().activeId); throw quota(); });
  const task = await checker.start(job());
  assert.equal((await settle(checker, task)).status, "failed");
  assert.deepEqual(calls, ["a", "b", "c"]);
  assert.equal(task.result, undefined);
  assert.match((await checker.status()).pausedReason, /No connected fallback/);
  assert.equal(task.error, (await checker.status()).pausedReason);
  for (const label of ["primary@example.test", "fallback@example.test · Registration 1", "third@example.test"]) {
    assert.ok(task.error.includes(`${label} (request, test): plan usage limit reached`));
    assert.equal(task.error.split(label).length, 2);
  }
  await assert.rejects(checker.start(job()), /No connected fallback/);
});

for (const scenario of [
  { reason: "required model unavailable", models: async () => [] },
  { reason: "authentication failed; reconnect this account", status: 401 },
  { reason: "access denied", status: 403 },
  { reason: "plan usage limit reached", status: 429, code: "subscription_sharing_usage_limit_exceeded" },
  { reason: "temporarily rate limited", status: 429, code: "rate_limit_exceeded" },
  { reason: "request failed (HTTP 503)", status: 503 },
  { reason: "connection or request failed" },
]) {
  test(`fallback diagnostics report model lookup: ${scenario.reason}`, async (t) => {
    const { checker } = await fixture(t, async () => { throw quota(); }, async (id) => {
      if (id !== "b") return [{ slug: "test" }];
      if (scenario.models) return scenario.models();
      throw Object.assign(new Error("Private provider payload: secret-token"), { status: scenario.status, code: scenario.code });
    });
    const task = await settle(checker, await checker.start(job()));
    assert.equal(task.status, "failed");
    assert.ok(task.error.includes("primary@example.test (request, test): plan usage limit reached"));
    assert.ok(task.error.includes(`fallback@example.test · Registration 1 (model lookup, test): ${scenario.reason}`));
    assert.doesNotMatch(task.error, /secret-token|Private provider/);
    assert.equal((await checker.status()).pausedReason, task.error);
  });
}

test("fallback diagnostics include a failed account selection", async (t) => {
  const { checker, chatgpt } = await fixture(t, async () => { throw quota(); });
  chatgpt.select = async () => { throw Object.assign(new Error("Busy"), { status: 409 }); };
  const task = await settle(checker, await checker.start(job()));
  assert.match(task.error, /fallback@example.test · Registration 1 \(account selection, test\): request failed \(HTTP 409\)/);
  assert.equal((await checker.status()).pausedReason, task.error);
});

test("fallback diagnostics retain prior attempts when inference fails without a usage limit", async (t) => {
  const { checker, selected } = await fixture(t, async ({ chatgpt }) => {
    if (chatgpt.connectionStatus().activeId === "a") throw quota();
    throw Object.assign(new Error("Private provider payload"), { status: 403 });
  });
  const task = await settle(checker, await checker.start(job()));
  assert.deepEqual(selected, ["b"]);
  assert.match(task.error, /primary@example.test \(request, test\): plan usage limit reached/);
  assert.match(task.error, /fallback@example.test · Registration 1 \(request, test\): access denied/);
  assert.doesNotMatch(task.error, /Private provider/);
});

test("diagnostics preserve the model needed by each stage and account labels without IDs", async () => {
  let activeId = "private-account-a";
  let requiredModel = "index-model";
  const checkJob = { accountId: activeId };
  const chatgpt = {
    connectionStatus: () => ({ activeId, accounts: [] }),
    fallbackAccountIds: () => ["private-account-b", "private-account-c"],
    select: async (id) => { activeId = id; },
    models: async () => activeId === "private-account-c" ? [] : [{ slug: "index-model" }],
  };
  await assert.rejects(runWithAccountFallback({
    chatgpt, checkJob, isCurrent: () => true, isFallbackEnabled: () => true,
    getRequiredModel: () => requiredModel,
    run: async () => {
      if (activeId === "private-account-b") requiredModel = "checker-model";
      throw quota();
    },
  }), (error) => {
    assert.match(error.message, /Account 1 \(request, index-model\): plan usage limit reached/);
    assert.match(error.message, /Account 2 \(request, checker-model\): plan usage limit reached/);
    assert.match(error.message, /Account 3 \(model lookup, checker-model\): required model unavailable/);
    assert.doesNotMatch(error.message, /private-account/);
    return true;
  });
});

test("usage failure still identifies the original account when no fallback is connected", async (t) => {
  const { checker, chatgpt, selected } = await fixture(t, async () => { throw quota(); });
  chatgpt.fallbackAccountIds = () => [];
  const task = await settle(checker, await checker.start(job()));
  assert.match(task.error, /primary@example.test \(request, test\): plan usage limit reached/);
  assert.doesNotMatch(task.error, /fallback@example.test|third@example.test/);
  assert.deepEqual(selected, []);
});

for (const failure of [Object.assign(new Error("Rate limited"), { status: 429, code: "rate_limit_exceeded" }), Object.assign(new Error("Reconnect"), { status: 401 }), new Error("Network failure")]) {
  test(`does not rotate accounts for ${failure.message}`, async (t) => {
    const { checker, selected } = await fixture(t, async () => { throw failure; });
    assert.equal((await settle(checker, await checker.start(job()))).status, "failed");
    assert.deepEqual(selected, []);
  });
}

test("fallback can be disabled and rejects invalid settings", async (t) => {
  const { checker, selected } = await fixture(t, async () => { throw quota(); });
  await assert.rejects(checker.configure({ accountFallback: "true" }), /Invalid/);
  await checker.configure({ accountFallback: false });
  assert.equal((await settle(checker, await checker.start(job()))).status, "failed");
  assert.deepEqual(selected, []);
});

for (const reason of ["missing model", "disconnected", "exhausted catalog"]) {
  test(`skips fallback with ${reason}`, async (t) => {
    const calls = [];
    const { checker, selected } = await fixture(t, async ({ chatgpt }) => {
      calls.push(chatgpt.connectionStatus().activeId);
      if (chatgpt.connectionStatus().activeId === "a") throw quota();
      return result;
    }, async (id) => {
      if (id === "b") {
        if (reason === "disconnected") throw Object.assign(new Error("Reconnect"), { status: 401 });
        if (reason === "exhausted catalog") throw quota();
        return [{ slug: "other" }];
      }
      return [{ slug: "test" }];
    });
    assert.equal((await settle(checker, await checker.start(job()))).status, "completed");
    assert.deepEqual(selected, ["b", "c"]);
    assert.deepEqual(calls, ["a", "c"]);
  });
}

test("pausing during fallback model lookup prevents inference and further switches", async (t) => {
  let release; const calls = [];
  const { checker, selected } = await fixture(t, async ({ chatgpt }) => { calls.push(chatgpt.connectionStatus().activeId); throw quota(); }, async (id) => {
    if (id === "b") await new Promise((resolve) => { release = resolve; });
    return [{ slug: "test" }];
  });
  const task = await checker.start(job());
  await drainEventLoopUntil(() => Boolean(release));
  await checker.configure({ enabled: false }); release();
  assert.equal((await settle(checker, task)).status, "cancelled");
  assert.deepEqual(calls, ["a"]); assert.deepEqual(selected, ["b"]);
  assert.equal((await checker.status()).pausedReason, null);
});

test("fallback candidates exclude incomplete, signed-out, unconsented and duplicate subscribers", async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-fallback-auth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "chatgpt.json");
  const registration = (id, subject, patch = {}) => ({ id, subject, clientId: `client_${id}`, accessToken: "secret", scopes: ["chatgpt.tokens.use.direct"], ...patch });
  await writeFile(path, JSON.stringify({ hostId: "host", activeId: "a", accounts: [
    registration("a", "user1"), registration("duplicate-a", "user1"), registration("b", "user2"), registration("duplicate-b", "user2"),
    registration("incomplete", undefined), registration("signed-out", "user3", { accessToken: null }), registration("unconsented", "user4", { scopes: [] }), registration("c", "user5"),
  ] }));
  const auth = await openChatGPTAccountManager({ path }); t.after(() => auth.close());
  assert.deepEqual(auth.fallbackAccountIds(), ["b", "c"]);
  assert.deepEqual(auth.connectionStatus().fallbackIds, ["b", "c"]);
  assert.doesNotMatch(JSON.stringify(auth.connectionStatus()), /secret|user1|user2/);
});
