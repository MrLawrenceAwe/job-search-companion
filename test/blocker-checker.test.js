import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, stat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { readVerifiedProfile } from "../bridge/blockers/profile.js";
import { validateFindings, readCompletedResponse, runBlockerInference } from "../bridge/blockers/inference.js";
import { openBlockerChecker } from "../bridge/blockers/checker.js";
import { openChatGPTConnection } from "../bridge/blockers/chatgpt.js";
import { createBlockerRoutes } from "../bridge/blockers/routes.js";
import { createRequestHandler } from "../bridge/request-handler.js";
import { openSubmissionStore } from "../bridge/submission-store.js";
import { flushUntil } from "../test-support/async.js";

const profile = { hash: "profile-v1", facts: [{ id: "F1", text: "Provisional UK driving licence only.", source: "Verified profile" }], sources: [] };
const job = (id = "job111111") => ({ jobUrl: `https://uk.indeed.com/viewjob?jk=${id}`, description: "You must hold a full UK driving licence to visit customer sites in this role." });
const noBlockers = { outcome: "no_blockers_found", findings: [] };
const setup = async (infer, readProfile = async () => profile) => {
  const directory = await mkdtemp(join(tmpdir(), "jsc-blockers-"));
  const chatgpt = { connectionStatus: () => ({ planUsageEnabled: true, activeId: "account1" }), models: async () => [{ slug: "test-model" }], close() {} };
  const checker = await openBlockerChecker({ directory, profileSources: [], chatgpt, infer, readProfile });
  await checker.configure({ enabled: true, model: "test-model" });
  return { checker, directory, chatgpt };
};
const sse = (...events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
const completed = (text) => ({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] } });

test("evidence validation rejects invented quotes, profile IDs, and unsupported blocker claims", () => {
  const finding = { kind: "clear_blocker", requirementQuote: "full UK driving licence", explanation: "A full licence is mandatory; the verified profile confirms provisional only.", profileFactIds: ["F1"] };
  assert.equal(validateFindings({ findings: [finding] }, job().description, profile)[0].profileFacts[0].id, "F1");
  for (const patch of [{ requirementQuote: "Commercial Kotlin required" }, { profileFactIds: ["F99"] }, { profileFactIds: [] }, { kind: "good_fit" }]) {
    assert.throws(() => validateFindings({ findings: [{ ...finding, ...patch }] }, job().description, profile));
  }
  assert.equal(validateFindings({ findings: [{ ...finding, kind: "uncertain_requirement", profileFactIds: [] }] }, job().description, profile).length, 1);
});

test("SSE completion requires the terminal event; limit failures after deltas remain failures", async () => {
  await assert.rejects(readCompletedResponse(sse({ type: "response.output_text.delta", delta: '{"findings":[]}' })), /before completion/);
  await assert.rejects(readCompletedResponse(sse(completed('{"findings":[]}'), { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } })), (error) => error.status === 429);
  assert.deepEqual(await readCompletedResponse(sse(completed('{"findings":[]}'))), { findings: [] });
  await assert.rejects(readCompletedResponse(sse(completed(""))), /without checker findings/);
});

test("plan-usage streams retain completed output items but require successful response completion", async () => {
  const item = { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"findings":[]}' }] } };
  const terminal = { type: "response.completed", response: { status: "completed", output: [] } };
  assert.deepEqual(await readCompletedResponse(sse(item, terminal)), { findings: [] });
  await assert.rejects(readCompletedResponse(sse(item)), /before completion/);
  await assert.rejects(readCompletedResponse(sse(item, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } })), (error) => error.status === 429);
});

test("inference uses plan-compatible parameters and produces only blocker findings", async () => {
  let captured;
  const chatgpt = { async request(endpoint, options) { captured = { endpoint, ...JSON.parse(options.body) }; return sse(completed('{"findings":[]}')); } };
  assert.deepEqual(await runBlockerInference({ chatgpt, model: "test-model", description: job().description, profile }), noBlockers);
  assert.equal(captured.store, false); assert.equal(captured.stream, true); assert.equal(captured.endpoint, "responses");
  assert.ok(Array.isArray(captured.input)); assert.equal(captured.background, undefined); assert.equal(captured.tools, undefined);
  assert.equal(captured.service_tier, undefined);
  await runBlockerInference({ chatgpt, model: "gpt-6-luna", description: job().description, profile });
  assert.equal(captured.service_tier, "priority");
  assert.equal(captured.reasoning, undefined);
});

test("checker deduplicates across tabs, persists results, and invalidates profile or description changes", async () => {
  let calls = 0; let currentProfile = profile;
  const { checker, directory, chatgpt } = await setup(async () => { calls++; return noBlockers; }, async () => currentProfile);
  const a = await checker.start(job()); const b = await checker.start(job());
  assert.equal(a.id, b.id);
  await flushUntil(() => checker.get(a.id).status === "completed", 100);
  assert.equal(checker.get(a.id).status, "completed");
  assert.equal((await checker.start(job())).cached, true); assert.equal(calls, 1);
  currentProfile = { ...profile, hash: "profile-v2" };
  const changed = await checker.start(job()); await flushUntil(() => checker.get(changed.id).status === "completed", 100);
  assert.equal(calls, 2);
  const changedText = await checker.start({ ...job(), description: job().description + " Travel every day." });
  await flushUntil(() => checker.get(changedText.id).status === "completed", 100);
  assert.equal(calls, 3);
  checker.close();
  const restored = await openBlockerChecker({ directory, profileSources: [], chatgpt, infer: async () => { throw new Error("Should be cached"); }, readProfile: async () => currentProfile });
  assert.equal((await restored.start(job())).cached, true);
  assert.equal((await stat(join(directory, "cache.json"))).mode & 0o777, 0o600); restored.close();
});

test("current selections outrank unstarted checks and pausing cancels waiting work", async () => {
  let resolve; const order = [];
  const { checker } = await setup(async ({ description }) => { order.push(description); if (order.length === 1) await new Promise((r) => { resolve = r; }); return noBlockers; });
  const a = await checker.start(job("first1111"));
  const b = await checker.start({ ...job("second111"), description: job().description + " Second." });
  const c = await checker.start({ ...job("third1111"), description: job().description + " Third." });
  resolve();
  for (let attempt = 0; attempt < 100 && checker.get(b.id).status !== "completed"; attempt++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(checker.get(b.id).status, "completed");
  assert.ok(order[1].endsWith("Third.")); assert.equal(checker.get(a.id).status, "completed"); assert.equal(checker.get(c.id).status, "completed");
  await checker.configure({ enabled: false });
  await assert.rejects(checker.start(job("fourth111")), /paused/); checker.close();
});

test("clearing the cache during a running check prevents a late result from being saved", async () => {
  let resolve;
  const { checker, directory } = await setup(async () => { await new Promise((r) => { resolve = r; }); return noBlockers; });
  const task = await checker.start(job()); await checker.clearCache(); resolve();
  await flushUntil(() => checker.get(task.id).status === "cancelled");
  assert.deepEqual(JSON.parse(await readFile(join(directory, "cache.json"), "utf8")).results, {}); checker.close();
});

test("limit errors pause inference without caching a clean outcome or billing fallback", async () => {
  let calls = 0;
  const { checker } = await setup(async () => { calls++; throw Object.assign(new Error("Usage limit reached"), { status: 429 }); });
  const task = await checker.start(job()); await flushUntil(() => checker.get(task.id).status === "failed");
  await assert.rejects(checker.start(job()), /Usage limit/); assert.equal(calls, 1); assert.equal(checker.get(task.id).result, undefined); checker.close();
});

test("checker refuses LinkedIn, partial input, unavailable profiles and unadvertised models", async () => {
  const { checker } = await setup(async () => noBlockers);
  await assert.rejects(checker.start({ ...job(), jobUrl: "https://www.linkedin.com/jobs/view/123456789/" }), /Indeed/);
  await assert.rejects(checker.start({ ...job(), description: "short" }), /full job description/);
  await assert.rejects(checker.configure({ model: "not-available" }), /available/); checker.close();
});

test("profile snapshot selects relevant facts while excluding contact and sensitive data", async () => {
  const { writeFile } = await import("node:fs/promises");
  const directory = await mkdtemp(join(tmpdir(), "jsc-profile-"));
  const p1 = join(directory, "application.md"); const p2 = join(directory, "verified.md");
  await writeFile(p1, "## Personal Constraints\n- Provisional licence only.\n## Education\n- BSc Computer Science.\n");
  await writeFile(p2, "## Facts\nContact:\n- Email: private@example.test.\nDriving:\n- Driving licence: provisional.\nIdentity and disclosure facts:\n- Religion: private.\n## Preferences\n- Relocation: ask per job.\n- Cover letters: short.\n");
  const profileSources = [{ kind: "application", path: p1 }, { kind: "verified", path: p2 }];
  const result = await readVerifiedProfile(profileSources);
  const reversed = await readVerifiedProfile([...profileSources].reverse());
  const sourceFacts = (profile) => profile.facts.map(({ text, source }) => ({ text, source }))
    .sort((left, right) => left.text.localeCompare(right.text));
  assert.deepEqual(sourceFacts(reversed), sourceFacts(result));
  await assert.rejects(readVerifiedProfile([{ kind: "unknown", path: p1 }]), /Unknown profile source kind/);
  assert.equal(result.facts.length, 4); assert.doesNotMatch(JSON.stringify(result.facts), /private|Cover letters/);
});

test("OAuth validates state and identity before activating a registration, preserving host ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jsc-auth-")); let nonce; let tokenParams;
  const path = join(directory, "chatgpt.json");
  const auth = await openChatGPTConnection({ path, verifyIdentity: async (_token, clientId, expectedNonce) => { assert.equal(clientId, "oaiapp_test"); assert.equal(expectedNonce, nonce); return { sub: "user1", email: "user@example.test" }; }, fetchImpl: async (_url, options) => {
    tokenParams = new URLSearchParams(options.body); return Response.json({ access_token: "test-access", refresh_token: "test-refresh", id_token: "test-id", token_type: "Bearer", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct" });
  } });
  const { authUrl } = await auth.signIn({ newAccount: true }); const url = new URL(authUrl); nonce = url.searchParams.get("nonce");
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client"); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const callback = new URL(url.searchParams.get("redirect_uri")); callback.search = new URLSearchParams({ state: "wrong", code: "code", client_id: "oaiapp_test" });
  assert.equal((await fetch(callback)).status, 400); assert.equal(auth.connectionStatus().connected, false);
  callback.searchParams.set("state", url.searchParams.get("state")); assert.equal((await fetch(callback)).status, 200);
  assert.equal(auth.connectionStatus().planUsageEnabled, true); assert.equal(tokenParams.get("client_id"), "oaiapp_test"); assert.equal(tokenParams.get("redirect_uri"), url.searchParams.get("redirect_uri"));
  assert.doesNotMatch(JSON.stringify(auth.connectionStatus()), /test-access|test-refresh|test-id/);
  const hostId = JSON.parse(await readFile(path)).hostId;
  await auth.logout(); const second = new URL((await auth.signIn()).authUrl);
  assert.equal(second.searchParams.get("ext_agent_host_id"), hostId); assert.equal(second.searchParams.get("client_id"), "oaiapp_test");
  auth.close(); assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("checker routes require the existing bridge authentication boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jsc-routes-"));
  const handler = createRequestHandler({ bridgeConfig: { token: "token", allowedExtensionOrigin: "chrome-extension://test" }, submissionStore: await openSubmissionStore(join(await realpath(directory), "submissions.json")), blockerRoutes: createBlockerRoutes({ checker: { status: async () => ({ settings: { enabled: false } }) } }) });
  const server = createServer((req, res) => void handler(req, res)); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/blockers/status`;
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { headers: { "X-JSC-Token": "token", Origin: "https://uk.indeed.com" } })).status, 403);
    const response = await fetch(url, { headers: { "X-JSC-Token": "token", Origin: "chrome-extension://test" } });
    assert.equal(response.status, 200); assert.equal((await response.json()).settings.enabled, false);
  } finally { server.close(); }
});
