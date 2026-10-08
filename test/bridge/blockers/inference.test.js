import assert from "node:assert/strict";
import test from "node:test";
import { validateFindings, readCompletedResponse, runBlockerInference } from "../../../bridge/blockers/inference.js";

const profile = { hash: "profile-v1", facts: [{ id: "F1", text: "Provisional UK driving licence only.", source: "Verified profile" }], sources: [] };
const job = (id = "job111111") => ({ jobUrl: `https://uk.indeed.com/viewjob?jk=${id}`, description: "You must hold a full UK driving licence to visit customer sites in this role." });
const noBlockers = { outcome: "no_blockers_found", findings: [] };
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
  assert.deepEqual(captured.reasoning, { effort: "medium" });
  await runBlockerInference({ chatgpt, model: "gpt-6-luna", reasoningEffort: "low", description: job().description, profile });
  assert.deepEqual(captured.reasoning, { effort: "low" });
});
