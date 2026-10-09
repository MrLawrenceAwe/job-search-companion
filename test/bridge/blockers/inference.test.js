import assert from "node:assert/strict";
import test from "node:test";
import { validateRequirements, readCompletedResponse, runBlockerInference } from "../../../bridge/blockers/inference.js";

const profile = { hash: "profile-v1", facts: [{ id: "F1", text: "Provisional UK driving licence only.", source: "Verified profile" }], sources: [] };
const job = (id = "job111111") => ({ jobUrl: `https://uk.indeed.com/viewjob?jk=${id}`, description: "You must hold a full UK driving licence to visit customer sites in this role." });
const noBlockers = { outcome: "no_blockers_found", findings: [] };
const sse = (...events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
const completed = (text) => ({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] } });

test("evidence validation rejects invented quotes, profile IDs, and unsupported blocker claims", () => {
  const finding = { necessity: "mandatory", evidence: "incompatible", requirementQuote: "full UK driving licence", explanation: "A full licence is mandatory; the verified profile confirms provisional only.", profileFactIds: ["F1"] };
  assert.equal(validateRequirements({ requirements: [finding] }, job().description, profile)[0].profileFacts[0].id, "F1");
  for (const patch of [{ requirementQuote: "Commercial Kotlin required" }, { profileFactIds: ["F99"] }, { profileFactIds: [] }, { necessity: "good_fit" }]) {
    assert.throws(() => validateRequirements({ requirements: [{ ...finding, ...patch }] }, job().description, profile));
  }
  assert.equal(validateRequirements({ requirements: [{ ...finding, evidence: "missing", profileFactIds: [] }] }, job().description, profile).length, 1);
});

test("SSE completion requires the terminal event; limit failures after deltas remain failures", async () => {
  await assert.rejects(readCompletedResponse(sse({ type: "response.output_text.delta", delta: '{"requirements":[]}' })), /before completion/);
  await assert.rejects(readCompletedResponse(sse(completed('{"requirements":[]}'), { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } })), (error) => error.status === 429);
  assert.deepEqual(await readCompletedResponse(sse(completed('{"requirements":[]}'))), { requirements: [] });
  await assert.rejects(readCompletedResponse(sse(completed(""))), /without checker findings/);
});

test("plan-usage streams retain completed output items but require successful response completion", async () => {
  const item = { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"requirements":[]}' }] } };
  const terminal = { type: "response.completed", response: { status: "completed", output: [] } };
  assert.deepEqual(await readCompletedResponse(sse(item, terminal)), { requirements: [] });
  await assert.rejects(readCompletedResponse(sse(item)), /before completion/);
  await assert.rejects(readCompletedResponse(sse(item, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } })), (error) => error.status === 429);
});

test("inference uses plan-compatible parameters and produces only blocker findings", async () => {
  let captured;
  const chatgpt = { async request(endpoint, options) { captured = { endpoint, ...JSON.parse(options.body) }; return sse(completed('{"requirements":[]}')); } };
  assert.deepEqual(await runBlockerInference({ chatgpt, model: "test-model", description: "Handle customer enquiries, update records and coordinate appointments.", profile }), noBlockers);
  assert.equal(captured.store, false); assert.equal(captured.stream, true); assert.equal(captured.endpoint, "responses");
  assert.ok(Array.isArray(captured.input)); assert.equal(captured.background, undefined); assert.equal(captured.tools, undefined);
  assert.equal(captured.service_tier, undefined);
  await runBlockerInference({ chatgpt, model: "gpt-6-luna", description: "Handle customer enquiries, update records and coordinate appointments.", profile });
  assert.equal(captured.service_tier, "priority");
  assert.deepEqual(captured.reasoning, { effort: "medium" });
  await runBlockerInference({ chatgpt, model: "gpt-6-luna", reasoningEffort: "low", description: "Handle customer enquiries, update records and coordinate appointments.", profile });
  assert.deepEqual(captured.reasoning, { effort: "low" });
});

test("specialist experience without evidence cannot collapse into a clean result; optional bookkeeping stays optional", async () => {
  const description = "We are seeking an Administrator with experience in the renewal energy sector. Experience with compliance documentation including MCS records, Building regulations, insurance backed guarantees, electrical certificates and heat loss designs. Familiarity with basic accounting or bookkeeping is a plus but not required.";
  const requirements = [
    { necessity: "mandatory", evidence: "missing", requirementQuote: "with experience in the renewal energy sector", explanation: "Sector experience is requested, but is not evidenced.", profileFactIds: [] },
    { necessity: "uncertain", evidence: "missing", requirementQuote: "Experience with compliance documentation including MCS records, Building regulations, insurance backed guarantees, electrical certificates and heat loss designs.", explanation: "Specialist compliance experience is not established by general administration skills.", profileFactIds: [] },
    { necessity: "preferred", evidence: "missing", requirementQuote: "Familiarity with basic accounting or bookkeeping is a plus but not required.", explanation: "Explicitly optional.", profileFactIds: [] },
  ];
  const result = await runBlockerInference({ chatgpt: { request: async () => sse(completed(JSON.stringify({ requirements }))) }, model: "test", description, profile });
  assert.equal(result.outcome, "uncertain_requirement");
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every((finding) => finding.kind === "uncertain_requirement"));
});

test("CV evidence can satisfy a requirement but uncertain/contradictory evidence stays uncertain", () => {
  const description = "Proven office experience. Commercial automation experience required.";
  const cvProfile = { facts: [{ id: "CV1", text: "Office administration - Employer | 2025", source: "CV: source.pdf" }] };
  const requirement = { necessity: "mandatory", evidence: "supported", requirementQuote: "Proven office experience.", explanation: "Documented office administration.", profileFactIds: ["CV1"] };
  assert.deepEqual(validateRequirements({ requirements: [requirement] }, description, cvProfile), []);
  assert.throws(() => validateRequirements({ requirements: [{ ...requirement, profileFactIds: [] }] }, description, cvProfile));
  for (const patch of [{ evidence: "conflicting" }, { necessity: "uncertain", evidence: "incompatible" }])
    assert.equal(validateRequirements({ requirements: [{ ...requirement, ...patch }] }, description, cvProfile)[0].kind, "uncertain_requirement");
  assert.throws(() => validateRequirements({ findings: [] }, description, cvProfile));
});

test("an empty inventory cannot claim a clean result for explicit candidate requirements", () => {
  assert.throws(() => validateRequirements({ requirements: [] }, job().description, profile), /no requirement inventory/);
  assert.throws(() => validateRequirements({ requirements: [] }, "Administrator with experience in renewables.", profile), /no requirement inventory/);
  assert.deepEqual(validateRequirements({ requirements: [] }, "Handle enquiries and file records.", profile), []);
});
