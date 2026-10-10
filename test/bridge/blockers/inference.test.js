import assert from "node:assert/strict";
import test from "node:test";
import { deriveValidatedFindings, runBlockerInference } from "../../../bridge/blockers/inference.js";

const profile = { hash: "profile-v1", facts: [{ id: "F1", text: "Provisional UK driving licence only.", source: "Verified profile" }], sources: [] };
const job = (id = "job111111") => ({ jobUrl: `https://uk.indeed.com/viewjob?jk=${id}`, description: "You must hold a full UK driving licence to visit customer sites in this role." });
const noBlockers = { outcome: "no_blockers_found", findings: [] };
const sse = (...events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
const completed = (text) => ({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] } });

test("evidence validation rejects invented quotes, profile IDs, and unsupported blocker claims", () => {
  const finding = { category: "eligibility", necessity: "mandatory", evidence: "incompatible", requirementQuote: "full UK driving licence", explanation: "A full licence is mandatory; the verified profile confirms provisional only.", profileFactIds: ["F1"] };
  assert.equal(deriveValidatedFindings({ requirements: [finding] }, job().description, profile)[0].profileFacts[0].id, "F1");
  for (const patch of [{ requirementQuote: "Commercial Kotlin required" }, { profileFactIds: ["F99"] }, { profileFactIds: [] }, { category: "eligibility", necessity: "good_fit" }]) {
    assert.throws(() => deriveValidatedFindings({ requirements: [{ ...finding, ...patch }] }, job().description, profile));
  }
  assert.equal(deriveValidatedFindings({ requirements: [{ ...finding, evidence: "missing", profileFactIds: [] }] }, job().description, profile).length, 1);
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
    { category: "eligibility", necessity: "mandatory", evidence: "missing", requirementQuote: "with experience in the renewal energy sector", explanation: "Sector experience is requested, but is not evidenced.", profileFactIds: [] },
    { category: "eligibility", necessity: "uncertain", evidence: "missing", requirementQuote: "Experience with compliance documentation including MCS records, Building regulations, insurance backed guarantees, electrical certificates and heat loss designs.", explanation: "Specialist compliance experience is not established by general administration skills.", profileFactIds: [] },
    { category: "eligibility", necessity: "preferred", evidence: "missing", requirementQuote: "Familiarity with basic accounting or bookkeeping is a plus but not required.", explanation: null, profileFactIds: [] },
  ];
  const result = await runBlockerInference({ chatgpt: { request: async () => sse(completed(JSON.stringify({ requirements }))) }, model: "test", description, profile });
  assert.equal(result.outcome, "clear_blocker");
  assert.equal(result.findings.length, 2);
  assert.deepEqual(result.findings.map((finding) => finding.kind), ["clear_blocker", "uncertain_requirement"]);
});

test("personal qualities produce no findings even under essential requirements", async () => {
  const qualities = [
    "Self-driven – You're motivated by a sales environment where achieving the right customer outcomes is key and always in line with FCA requirements.",
    "Empathetic and an active listener – Understanding customers' needs is crucial when recommending suitable products and building trust.",
    "Resilient and adaptable – Sales can be challenging and regulations evolve.",
    "Curious with a growth mindset – You're eager to learn about new products, compliance updates and customer perspectives.",
    "A clear communicator – You explain products confidently, transparently and in a way customers can easily understand.",
    "Independent – You are ambitious, innovative and comfortable working autonomously from home.",
  ];
  const description = `Essential requirements:\n${qualities.join("\n")}`;
  let captured;
  const requirements = qualities.map((requirementQuote) => ({
    category: "eligibility", necessity: "excluded", evidence: "missing", requirementQuote,
    explanation: null, profileFactIds: [],
  }));
  const result = await runBlockerInference({ chatgpt: { async request(endpoint, options) {
    captured = JSON.parse(options.body);
    return sse(completed(JSON.stringify({ requirements })));
  } }, model: "test", description, profile });
  assert.deepEqual(result, noBlockers);
  assert.ok(captured.text.format.schema.properties.requirements.items.anyOf.some((schema) => schema.properties.necessity.enum.includes("excluded")));
  assert.match(captured.instructions, /even when called essential or required/);
  assert.match(captured.instructions, /Do not turn the explanatory duties attached to a trait/);
});

test("excluding a personal quality preserves a separately stated sales prerequisite and work constraint", () => {
  const description = "Self-driven; two years of outbound sales experience required. Must attend the office three days a week.";
  const requirement = (necessity, requirementQuote) => ({ category: requirementQuote.startsWith("Must attend") ? "work_arrangement" : "eligibility", necessity, requirementQuote,
    evidence: "missing", explanation: necessity === "excluded" ? null : "Evidence is not established.", profileFactIds: [] });
  const findings = deriveValidatedFindings({ requirements: [
    requirement("excluded", "Self-driven"),
    requirement("mandatory", "two years of outbound sales experience required"),
    requirement("mandatory", "Must attend the office three days a week."),
  ] }, description, profile);
  assert.deepEqual(findings.map(({ kind, requirementQuote }) => ({ kind, requirementQuote })), [
    { kind: "clear_blocker", requirementQuote: "two years of outbound sales experience required" },
    { kind: "uncertain_requirement", requirementQuote: "Must attend the office three days a week." },
  ]);
});

test("CV evidence can satisfy a requirement; essential conflicts block and uncertain necessity stays uncertain", () => {
  const description = "Proven office experience. Commercial automation experience required.";
  const cvProfile = { facts: [{ id: "CV1", text: "Office administration - Employer | 2025", source: "CV: source.pdf" }] };
  const requirement = { category: "eligibility", necessity: "mandatory", evidence: "supported", requirementQuote: "Proven office experience.", explanation: null, profileFactIds: ["CV1"] };
  assert.deepEqual(deriveValidatedFindings({ requirements: [requirement] }, description, cvProfile), []);
  assert.throws(() => deriveValidatedFindings({ requirements: [{ ...requirement, profileFactIds: [] }] }, description, cvProfile));
  assert.equal(deriveValidatedFindings({ requirements: [{ ...requirement, explanation: "Conflicting evidence.", evidence: "conflicting" }] }, description, cvProfile)[0].kind, "clear_blocker");
  assert.equal(deriveValidatedFindings({ requirements: [{ ...requirement, explanation: "Incompatible evidence.", necessity: "uncertain", evidence: "incompatible" }] }, description, cvProfile)[0].kind, "uncertain_requirement");
  assert.throws(() => deriveValidatedFindings({ findings: [] }, description, cvProfile));
});

test("an empty inventory cannot claim a clean result for explicit candidate requirements", () => {
  assert.throws(() => deriveValidatedFindings({ requirements: [] }, job().description, profile), /no requirement inventory/);
  assert.throws(() => deriveValidatedFindings({ requirements: [] }, "Administrator with experience in renewables.", profile), /no requirement inventory/);
  assert.deepEqual(deriveValidatedFindings({ requirements: [] }, "Handle enquiries and file records.", profile), []);
});

test("a paraphrased contract quote gets one corrective request with unchanged evidence and model options", async () => {
  const description = "This role requires both weekday and weekend working and is a 40 hour contract. You must hold a full UK driving licence.";
  const badQuote = { category: "work_arrangement", necessity: "mandatory", evidence: "missing", requirementQuote: "this is a 40 hour contract", explanation: "Full-time availability is unknown.", profileFactIds: [] };
  const driving = { category: "eligibility", necessity: "mandatory", evidence: "incompatible", requirementQuote: "You must hold a full UK driving licence.", explanation: "Only a provisional licence is documented.", profileFactIds: ["F1"] };
  const requests = [];
  const controller = new AbortController();
  const chatgpt = { async request(endpoint, options) {
    const body = JSON.parse(options.body);
    requests.push(body);
    assert.equal(options.signal, controller.signal);
    return sse(completed(JSON.stringify({ requirements: [
      { ...badQuote, requirementQuote: requests.length === 1 ? badQuote.requirementQuote : "is a 40 hour contract" }, driving,
    ] })));
  } };
  const result = await runBlockerInference({ chatgpt, model: "gpt-6-luna", reasoningEffort: "low", description, profile, signal: controller.signal });
  assert.equal(requests.length, 2);
  assert.equal(result.outcome, "clear_blocker");
  assert.equal(result.findings.length, 2);
  const initial = JSON.parse(requests[0].input[0].content);
  const corrected = JSON.parse(requests[1].input[0].content);
  assert.equal(initial.validationFeedback, undefined);
  assert.deepEqual(corrected.verifiedProfile, initial.verifiedProfile);
  assert.equal(corrected.jobDescription, description);
  assert.equal(corrected.validationFeedback.rejectedQuote, badQuote.requirementQuote);
  assert.equal(corrected.validationFeedback.requirementIndex, 1);
  assert.deepEqual(requests[1].reasoning, { effort: "low" });
  assert.equal(requests[1].service_tier, "priority");
  assert.deepEqual(requests[1].text, requests[0].text);
});

test("a second invalid quote fails specifically instead of dropping the requirement", async () => {
  let calls = 0;
  const chatgpt = { async request() {
    calls += 1;
    return sse(completed(JSON.stringify({ requirements: [{ category: "eligibility", necessity: "mandatory", evidence: "missing", requirementQuote: "Invented quote", explanation: "Unknown.", profileFactIds: [] }] })));
  } };
  await assert.rejects(runBlockerInference({ chatgpt, model: "test", description: job().description, profile }),
    { code: "requirement_quote_mismatch", message: "Checker requirement 1 was not quoted exactly from the advert. Retry the check." });
  assert.equal(calls, 2);
});

test("evidence, network and stream failures do not trigger a quote correction request", async () => {
  for (const scenario of ["evidence", "network", "stream"]) {
    let calls = 0;
    const chatgpt = { async request() {
      calls += 1;
      if (scenario === "network") throw new Error("Network failed");
      if (scenario === "stream") return sse({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } });
      return sse(completed(JSON.stringify({ requirements: [{ category: "eligibility", necessity: "mandatory", evidence: "incompatible", requirementQuote: "full UK driving licence", explanation: "Unknown fact.", profileFactIds: ["F99"] }] })));
    } };
    await assert.rejects(runBlockerInference({ chatgpt, model: "test", description: job().description, profile }));
    assert.equal(calls, 1, scenario);
  }
});

test("cancellation after a bad quote prevents the corrective request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const chatgpt = { async request() {
    calls += 1;
    controller.abort();
    return sse(completed(JSON.stringify({ requirements: [{ category: "eligibility", necessity: "mandatory", evidence: "missing", requirementQuote: "Invented quote", explanation: "Unknown.", profileFactIds: [] }] })));
  } };
  await assert.rejects(runBlockerInference({ chatgpt, model: "test", description: job().description, profile, signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});


test("essential phone repair experience blocks when missing, incompatible or conflicting; supported experience clears", async () => {
  const description = "Minimum 3 year of hands-on experience repairing mobile phones, with proven experience repairing both iPhones and Android devices – this is essential.";
  for (const evidence of ["missing", "incompatible", "conflicting", "supported"]) {
    const repairProfile = { facts: [{ id: "R1", text: evidence === "supported" ? "Three years repairing both iPhones and Android devices." : "One year repairing iPhones only.", source: "Verified profile" }] };
    const requirement = { category: "eligibility", necessity: "mandatory", evidence, requirementQuote: description,
      explanation: evidence === "supported" ? null : evidence === "missing" ? "Your evidence does not establish three years of repairs covering both iPhones and Android devices." : "Repair evidence assessed against the essential requirement.",
      profileFactIds: evidence === "missing" ? [] : ["R1"] };
    const result = await runBlockerInference({ chatgpt: { request: async () => sse(completed(JSON.stringify({ requirements: [requirement] }))) }, model: "test", description, profile: repairProfile });
    assert.equal(result.outcome, evidence === "supported" ? "no_blockers_found" : "clear_blocker", evidence);
    if (evidence !== "supported") {
      assert.equal(result.findings[0].kind, "clear_blocker");
      assert.equal(result.findings[0].explanation, requirement.explanation);
      assert.equal(result.findings[0].profileFacts.length, evidence === "missing" ? 0 : 1);
    }
  }
});

test("mandatory onsite hours need clarification unless availability is explicitly incompatible", async () => {
  const description = "Full-Time on-site, Monday to Friday with occasional hybrid working. BPSS with eligibility to obtain SC Clearance required";
  for (const evidence of ["missing", "conflicting", "incompatible", "supported"]) {
    const availabilityProfile = { facts: evidence === "missing" ? [] : [
      { id: "A1", text: evidence === "supported" ? "Available full-time onsite Monday to Friday." : "Only available for remote work.", source: "Verified profile" },
      ...(evidence === "conflicting" ? [{ id: "A2", text: "Available full-time onsite Monday to Friday.", source: "Verified profile" }] : []),
    ] };
    const arrangement = { category: "work_arrangement", necessity: "mandatory", evidence,
      requirementQuote: "Full-Time on-site, Monday to Friday with occasional hybrid working",
      explanation: evidence === "supported" ? null : "Availability assessed against the stated onsite schedule.",
      profileFactIds: evidence === "missing" ? [] : evidence === "conflicting" ? ["A1", "A2"] : ["A1"] };
    const chatgpt = { request: async () => sse(completed(JSON.stringify({ requirements: [arrangement] }))) };
    const result = await runBlockerInference({ chatgpt, model: "test", description, profile: availabilityProfile });
    assert.equal(result.outcome, evidence === "supported" ? "no_blockers_found"
      : evidence === "incompatible" ? "clear_blocker" : "uncertain_requirement", evidence);
    const clearance = { ...arrangement, category: "eligibility", evidence: "missing", profileFactIds: [],
      requirementQuote: "BPSS with eligibility to obtain SC Clearance required", explanation: "Clearance eligibility is not established." };
    const findings = deriveValidatedFindings({ requirements: [arrangement, clearance] }, description, availabilityProfile);
    assert.equal(findings.at(-1).kind, "clear_blocker");
  }
});

test("requirement categories are required and validated", () => {
  const requirement = { category: "eligibility", necessity: "mandatory", evidence: "missing",
    requirementQuote: "full UK driving licence", explanation: "Licence evidence is missing.", profileFactIds: [] };
  for (const category of [undefined, "logistics", null]) {
    assert.throws(() => deriveValidatedFindings({ requirements: [{ ...requirement, category }] }, job().description, profile));
  }
  const { category, ...withoutCategory } = requirement;
  assert.throws(() => deriveValidatedFindings({ requirements: [withoutCategory] }, job().description, profile));
});

test("null explanations keep non-finding quotes and evidence validated; findings still require explanations", () => {
  const requirement = { category: "eligibility", necessity: "mandatory", evidence: "supported",
    requirementQuote: "full UK driving licence", explanation: null, profileFactIds: ["F1"] };
  const validate = (patch) => deriveValidatedFindings({ requirements: [{ ...requirement, ...patch }] }, job().description, profile);
  assert.deepEqual(validate({}), []);
  assert.throws(() => validate({ requirementQuote: "Invented prerequisite" }), { code: "requirement_quote_mismatch" });
  assert.throws(() => validate({ profileFactIds: ["F99"] }), /supplied evidence/);
  assert.throws(() => validate({ profileFactIds: [] }), /supplied evidence/);
  assert.throws(() => validate({ explanation: "Unused explanation" }), /supplied evidence/);
  for (const necessity of ["mandatory", "uncertain"]) {
    for (const explanation of [null, "", "   "]) {
      assert.throws(() => validate({ necessity, evidence: "missing", profileFactIds: [], explanation }), /supplied evidence/);
    }
  }
  assert.equal(validate({ evidence: "missing", profileFactIds: [], explanation: "Licence evidence is missing." })[0].explanation,
    "Licence evidence is missing.");
});

test("quote validation retains whitespace normalization across a full inventory", () => {
  const description = "Essential requirements:\nFull UK\t driving licence.\nOnsite\nMonday to Friday.";
  const requirements = ["Full UK driving licence.", "Onsite Monday to Friday."].map((requirementQuote) => ({
    category: "eligibility", necessity: "mandatory", evidence: "missing", requirementQuote,
    explanation: "Evidence is missing.", profileFactIds: [],
  }));
  assert.equal(deriveValidatedFindings({ requirements }, description, profile).length, 2);
});
