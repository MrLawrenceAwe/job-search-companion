import assert from "node:assert/strict";
import test from "node:test";
import { runBlockerInference } from "../../../bridge/blockers/inference.js";
import { deriveValidatedFindings } from "../../../bridge/blockers/inference-validation.js";
import { requirementInventorySchema } from "../../../bridge/blockers/inference-schemas.js";

const profile = { hash: "profile-v1", facts: [{ id: "F1", text: "Provisional UK driving licence only.", source: "Profile evidence" }], sources: [] };
const job = (id = "job111111") => ({ jobUrl: `https://uk.indeed.com/viewjob?jk=${id}`, description: "You must hold a full UK driving licence to visit customer sites in this role." });
const noBlockers = { outcome: "no_blockers_found", findings: [] };
const sse = (...events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
const completed = (text) => ({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] } });

test("evidence validation rejects invented quotes, profile IDs, and unsupported blocker claims", () => {
  const finding = { category: "eligibility", necessity: "mandatory", evidence: "incompatible", requirementQuote: "full UK driving licence", explanation: "A full licence is mandatory; the profile evidence confirms provisional only.", suggestedChallenge: "Please reconsider this requirement against the advert and my existing evidence.", evidenceFactIds: ["F1"] };
  assert.equal(deriveValidatedFindings({ requirements: [finding] }, job().description, profile)[0].evidenceFacts[0].id, "F1");
  for (const patch of [{ requirementQuote: "Commercial Kotlin required" }, { evidenceFactIds: ["F99"] }, { evidenceFactIds: [] }, { category: "eligibility", necessity: "good_fit" }]) {
    assert.throws(() => deriveValidatedFindings({ requirements: [{ ...finding, ...patch }] }, job().description, profile));
  }
  assert.equal(deriveValidatedFindings({ requirements: [{ ...finding, evidence: "missing", evidenceFactIds: [] }] }, job().description, profile).length, 1);
});

test("inference uses plan-compatible parameters and produces only blocker findings", async () => {
  let captured;
  const chatgpt = { async request(endpoint, options) { captured = { endpoint, ...JSON.parse(options.body) }; return sse(completed('{"requirements":[]}')); } };
  assert.deepEqual(await runBlockerInference({ chatgpt, model: "test-model", description: "Handle customer enquiries, update records and coordinate appointments.", evidence: profile }), noBlockers);
  assert.equal(captured.store, false); assert.equal(captured.stream, true); assert.equal(captured.endpoint, "responses");
  assert.ok(Array.isArray(captured.input)); assert.equal(captured.background, undefined); assert.equal(captured.tools, undefined);
  assert.equal(captured.service_tier, undefined);
  await runBlockerInference({ chatgpt, model: "gpt-6-luna", description: "Handle customer enquiries, update records and coordinate appointments.", evidence: profile });
  assert.equal(captured.service_tier, "priority");
  assert.deepEqual(captured.reasoning, { effort: "medium" });
  await runBlockerInference({ chatgpt, model: "gpt-6-luna", reasoningEffort: "low", description: "Handle customer enquiries, update records and coordinate appointments.", evidence: profile });
  assert.deepEqual(captured.reasoning, { effort: "low" });
});

test("specialist experience without evidence cannot collapse into a clean result; optional bookkeeping stays optional", async () => {
  const description = "We are seeking an Administrator with experience in the renewal energy sector. Experience with compliance documentation including MCS records, Building regulations, insurance backed guarantees, electrical certificates and heat loss designs. Familiarity with basic accounting or bookkeeping is a plus but not required.";
  const requirements = [
    { category: "eligibility", necessity: "mandatory", evidence: "missing", requirementQuote: "with experience in the renewal energy sector", explanation: "Sector experience is requested, but is not evidenced.", suggestedChallenge: "Please reconsider this requirement against the advert and my existing evidence.", evidenceFactIds: [] },
    { category: "eligibility", necessity: "unclear", evidence: "missing", requirementQuote: "Experience with compliance documentation including MCS records, Building regulations, insurance backed guarantees, electrical certificates and heat loss designs.", explanation: null, suggestedChallenge: null, evidenceFactIds: [] },
    { category: "eligibility", necessity: "preferred", evidence: "missing", requirementQuote: "Familiarity with basic accounting or bookkeeping is a plus but not required.", explanation: null, suggestedChallenge: null, evidenceFactIds: [] },
  ];
  const result = await runBlockerInference({ chatgpt: { request: async () => sse(completed(JSON.stringify({ requirements }))) }, model: "test", description, evidence: profile });
  assert.equal(result.outcome, "blocker");
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings.map((finding) => finding.kind), ["blocker"]);
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
    explanation: null, suggestedChallenge: null, evidenceFactIds: [],
  }));
  const result = await runBlockerInference({ chatgpt: { async request(endpoint, options) {
    captured = JSON.parse(options.body);
    return sse(completed(JSON.stringify({ requirements })));
  } }, model: "test", description, evidence: profile });
  assert.deepEqual(result, noBlockers);
  assert.ok(captured.text.format.schema.properties.requirements.items.anyOf.some((schema) => schema.properties.necessity.enum.includes("excluded")));
  assert.match(captured.instructions, /even when called essential or required/);
  assert.match(captured.instructions, /Do not turn the explanatory duties attached to a trait/);
});

test("excluding a personal quality preserves a separately stated sales prerequisite and work constraint", () => {
  const description = "Self-driven; two years of outbound sales experience required. Must attend the office three days a week.";
  const requirement = (necessity, requirementQuote) => ({ category: requirementQuote.startsWith("Must attend") ? "work_arrangement" : "eligibility", necessity, requirementQuote,
    evidence: "missing", explanation: necessity === "excluded" || requirementQuote.startsWith("Must attend") ? null : "Evidence is not established.", suggestedChallenge: necessity === "excluded" || requirementQuote.startsWith("Must attend") ? null : "What evidence would establish the required sales experience?", evidenceFactIds: [] });
  const findings = deriveValidatedFindings({ requirements: [
    requirement("excluded", "Self-driven"),
    requirement("mandatory", "two years of outbound sales experience required"),
    requirement("mandatory", "Must attend the office three days a week."),
  ] }, description, profile);
  assert.deepEqual(findings.map(({ kind, requirementQuote }) => ({ kind, requirementQuote })), [
    { kind: "blocker", requirementQuote: "two years of outbound sales experience required" },
  ]);
});

test("CV evidence can satisfy a requirement; essential conflicts block and unclear necessity produces no finding", () => {
  const description = "Proven office experience. Commercial automation experience required.";
  const cvProfile = { facts: [{ id: "CV1", text: "Office administration - Employer | 2025", source: "CV: source.pdf" }] };
  const requirement = { category: "eligibility", necessity: "mandatory", evidence: "supported", requirementQuote: "Proven office experience.", explanation: null, suggestedChallenge: null, evidenceFactIds: ["CV1"] };
  assert.deepEqual(deriveValidatedFindings({ requirements: [requirement] }, description, cvProfile), []);
  assert.throws(() => deriveValidatedFindings({ requirements: [{ ...requirement, evidenceFactIds: [] }] }, description, cvProfile));
  assert.equal(deriveValidatedFindings({ requirements: [{ ...requirement, explanation: "Conflicting evidence.", suggestedChallenge: "Please reconsider this requirement against the advert and my existing evidence.", evidence: "conflicting" }] }, description, cvProfile)[0].kind, "blocker");
  assert.deepEqual(deriveValidatedFindings({ requirements: [{ ...requirement, explanation: null, suggestedChallenge: null, necessity: "unclear", evidence: "incompatible" }] }, description, cvProfile), []);
  assert.throws(() => deriveValidatedFindings({ findings: [] }, description, cvProfile));
});

test("an empty inventory cannot claim a clean result for explicit candidate requirements", () => {
  assert.throws(() => deriveValidatedFindings({ requirements: [] }, job().description, profile), /no requirement inventory/);
  assert.throws(() => deriveValidatedFindings({ requirements: [] }, "Administrator with experience in renewables.", profile), /no requirement inventory/);
  assert.deepEqual(deriveValidatedFindings({ requirements: [] }, "Handle enquiries and file records.", profile), []);
});

test("a paraphrased contract quote gets one corrective request with unchanged evidence and model options", async () => {
  const description = "This role requires both weekday and weekend working and is a 40 hour contract. You must hold a full UK driving licence.";
  const badQuote = { category: "work_arrangement", necessity: "mandatory", evidence: "missing", requirementQuote: "this is a 40 hour contract", explanation: null, suggestedChallenge: null, evidenceFactIds: [] };
  const driving = { category: "eligibility", necessity: "mandatory", evidence: "incompatible", requirementQuote: "You must hold a full UK driving licence.", explanation: "Only a provisional licence is documented.", suggestedChallenge: "Please reconsider this requirement against the advert and my existing evidence.", evidenceFactIds: ["F1"] };
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
  const result = await runBlockerInference({ chatgpt, model: "gpt-6-luna", reasoningEffort: "low", description, evidence: profile, signal: controller.signal });
  assert.equal(requests.length, 2);
  assert.equal(result.outcome, "blocker");
  assert.equal(result.findings.length, 1);
  const initial = JSON.parse(requests[0].input[0].content);
  const corrected = JSON.parse(requests[1].input[0].content);
  assert.equal(initial.validationFeedback, undefined);
  assert.deepEqual(corrected.candidateEvidence, initial.candidateEvidence);
  assert.equal(corrected.jobDescription, description);
  assert.equal(corrected.validationFeedback.rejectedQuote, badQuote.requirementQuote);
  assert.equal(corrected.validationFeedback.requirementIndex, 1);
  assert.deepEqual(requests[1].reasoning, { effort: "low" });
  assert.equal(requests[1].service_tier, "priority");
  assert.deepEqual(requests[1].text, requests[0].text);
  for (const { properties } of requests[0].text.format.schema.properties.requirements.items.anyOf) {
    assert.deepEqual(properties.evidenceFactIds.items.enum, ["F1"]);
    assert.equal(properties.evidenceFactIds.maxItems, properties.evidence.enum[0] === "missing" ? 0 : undefined);
    assert.equal(properties.evidenceFactIds.minItems, properties.evidence.enum[0] === "missing" ? undefined : 1);
  }
});

test("a second invalid quote fails specifically instead of dropping the requirement", async () => {
  let calls = 0;
  const chatgpt = { async request() {
    calls += 1;
    return sse(completed(JSON.stringify({ requirements: [{ category: "eligibility", necessity: "mandatory", evidence: "missing", requirementQuote: "Invented quote", explanation: "Unknown.", suggestedChallenge: "Please reconsider this requirement against the advert and my existing evidence.", evidenceFactIds: [] }] })));
  } };
  await assert.rejects(runBlockerInference({ chatgpt, model: "test", description: job().description, evidence: profile }),
    { code: "requirement_quote_mismatch", message: "Checker requirement 1 was not quoted exactly from the advert. Blocker status is unknown." });
  assert.equal(calls, 2);
});

test("network and stream failures do not trigger an inventory correction request", async () => {
  for (const scenario of ["network", "stream"]) {
    let calls = 0;
    const chatgpt = { async request() {
      calls += 1;
      if (scenario === "network") throw new Error("Network failed");
      return sse({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } });
    } };
    await assert.rejects(runBlockerInference({ chatgpt, model: "test", description: job().description, evidence: profile }));
    assert.equal(calls, 1, scenario);
  }
});

test("cancellation after a bad quote prevents the corrective request", async () => {
  let calls = 0;
  const controller = new AbortController();
  const chatgpt = { async request() {
    calls += 1;
    controller.abort();
    return sse(completed(JSON.stringify({ requirements: [{ category: "eligibility", necessity: "mandatory", evidence: "missing", requirementQuote: "Invented quote", explanation: "Unknown.", suggestedChallenge: "Please reconsider this requirement against the advert and my existing evidence.", evidenceFactIds: [] }] })));
  } };
  await assert.rejects(runBlockerInference({ chatgpt, model: "test", description: job().description, evidence: profile, signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});


test("essential phone repair experience blocks when missing, incompatible or conflicting; supported experience clears", async () => {
  const description = "Minimum 3 year of hands-on experience repairing mobile phones, with proven experience repairing both iPhones and Android devices – this is essential.";
  for (const evidence of ["missing", "incompatible", "conflicting", "supported"]) {
    const repairProfile = { facts: [{ id: "R1", text: evidence === "supported" ? "Three years repairing both iPhones and Android devices." : "One year repairing iPhones only.", source: "Profile evidence" }] };
    const requirement = { category: "eligibility", necessity: "mandatory", evidence, requirementQuote: description,
      explanation: evidence === "supported" ? null : evidence === "missing" ? "Your evidence does not establish three years of repairs covering both iPhones and Android devices." : "Repair evidence assessed against the essential requirement.",
      suggestedChallenge: evidence === "supported" ? null : "What repair evidence would resolve this finding?",
      evidenceFactIds: evidence === "missing" ? [] : ["R1"] };
    const result = await runBlockerInference({ chatgpt: { request: async () => sse(completed(JSON.stringify({ requirements: [requirement] }))) }, model: "test", description, evidence: repairProfile });
    assert.equal(result.outcome, evidence === "supported" ? "no_blockers_found" : "blocker", evidence);
    if (evidence !== "supported") {
      assert.equal(result.findings[0].kind, "blocker");
      assert.equal(result.findings[0].explanation, requirement.explanation);
      assert.equal(result.findings[0].evidenceFacts.length, evidence === "missing" ? 0 : 1);
    }
  }
});

test("mandatory onsite hours produce no finding unless availability is explicitly incompatible", async () => {
  const description = "Full-Time on-site, Monday to Friday with occasional hybrid working. BPSS with eligibility to obtain SC Clearance required";
  for (const evidence of ["missing", "conflicting", "incompatible", "supported"]) {
    const availabilityProfile = { facts: evidence === "missing" ? [] : [
      { id: "A1", text: evidence === "supported" ? "Available full-time onsite Monday to Friday." : "Only available for remote work.", source: "Profile evidence" },
      ...(evidence === "conflicting" ? [{ id: "A2", text: "Available full-time onsite Monday to Friday.", source: "Profile evidence" }] : []),
    ] };
    const arrangement = { category: "work_arrangement", necessity: "mandatory", evidence,
      requirementQuote: "Full-Time on-site, Monday to Friday with occasional hybrid working",
      explanation: evidence === "incompatible" ? "Availability assessed against the stated onsite schedule." : null,
      suggestedChallenge: evidence === "incompatible" ? "Please explain how my stated availability conflicts with this schedule." : null,
      evidenceFactIds: evidence === "missing" ? [] : evidence === "conflicting" ? ["A1", "A2"] : ["A1"] };
    const chatgpt = { request: async () => sse(completed(JSON.stringify({ requirements: [arrangement] }))) };
    const result = await runBlockerInference({ chatgpt, model: "test", description, evidence: availabilityProfile });
    assert.equal(result.outcome, evidence === "incompatible" ? "blocker" : "no_blockers_found", evidence);
    const clearance = { ...arrangement, category: "eligibility", evidence: "missing", evidenceFactIds: [],
      requirementQuote: "BPSS with eligibility to obtain SC Clearance required", explanation: "Clearance eligibility is not established.",
      suggestedChallenge: "What evidence would establish clearance eligibility?" };
    const findings = deriveValidatedFindings({ requirements: [arrangement, clearance] }, description, availabilityProfile);
    assert.equal(findings.at(-1).kind, "blocker");
  }
});

test("requirement categories are required and validated", () => {
  const requirement = { category: "eligibility", necessity: "mandatory", evidence: "missing",
    requirementQuote: "full UK driving licence", explanation: "Licence evidence is missing.", suggestedChallenge: "Please reconsider this requirement against the advert and my existing evidence.", evidenceFactIds: [] };
  for (const category of [undefined, "logistics", null]) {
    assert.throws(() => deriveValidatedFindings({ requirements: [{ ...requirement, category }] }, job().description, profile));
  }
  const { category, ...withoutCategory } = requirement;
  assert.throws(() => deriveValidatedFindings({ requirements: [withoutCategory] }, job().description, profile));
});

test("null explanations keep non-finding quotes and evidence validated; findings still require explanations", () => {
  const requirement = { category: "eligibility", necessity: "mandatory", evidence: "supported",
    requirementQuote: "full UK driving licence", explanation: null, suggestedChallenge: null, evidenceFactIds: ["F1"] };
  const validate = (patch) => deriveValidatedFindings({ requirements: [{ ...requirement, ...patch }] }, job().description, profile);
  assert.deepEqual(validate({}), []);
  assert.throws(() => validate({ requirementQuote: "Invented prerequisite" }), { code: "requirement_quote_mismatch" });
  assert.throws(() => validate({ evidenceFactIds: ["F99"] }), /invalid assessment/);
  assert.throws(() => validate({ evidenceFactIds: [] }), /invalid assessment/);
  assert.throws(() => validate({ explanation: "Unused explanation" }), /invalid assessment/);
  for (const necessity of ["mandatory"]) {
    for (const explanation of [null, "", "   "]) {
      assert.throws(() => validate({ necessity, evidence: "missing", evidenceFactIds: [], explanation }), /invalid assessment/);
    }
  }
  assert.deepEqual(validate({ necessity: "unclear", evidence: "missing", evidenceFactIds: [] }), []);
  assert.throws(() => validate({ necessity: "unclear", evidence: "missing", evidenceFactIds: [], explanation: "Unused explanation" }), /invalid assessment/);
  assert.equal(validate({ evidence: "missing", evidenceFactIds: [], explanation: "Licence evidence is missing.",
    suggestedChallenge: "What licence evidence would resolve this finding?" })[0].explanation,
    "Licence evidence is missing.");
});

test("quote validation retains whitespace normalization across a full inventory", () => {
  const description = "Essential requirements:\nFull UK\t driving licence.\nOnsite\nMonday to Friday.";
  const requirements = ["Full UK driving licence.", "Onsite Monday to Friday."].map((requirementQuote) => ({
    category: "eligibility", necessity: "mandatory", evidence: "missing", requirementQuote,
    explanation: "Evidence is missing.", suggestedChallenge: "Please reconsider this requirement against the advert and my existing evidence.", evidenceFactIds: [],
  }));
  assert.equal(deriveValidatedFindings({ requirements }, description, profile).length, 2);
});


test("the screenshot's vague geography and undocumented work arrangements produce no blockers", async () => {
  const description = 'Good general knowledge of geographical locations within the UK. Full time, Permanent. Hatfield based, AL9 5JN. Work Location: In person';
  const requirements = [
    { category: "eligibility", necessity: "excluded", requirementQuote: "Good general knowledge of geographical locations within the UK." },
    { category: "work_arrangement", necessity: "mandatory", requirementQuote: "Full time, Permanent" },
    { category: "work_arrangement", necessity: "excluded", requirementQuote: "Hatfield based, AL9 5JN" },
    { category: "work_arrangement", necessity: "mandatory", requirementQuote: "Work Location: In person" },
  ].map((requirement) => ({ ...requirement, evidence: "missing", explanation: null, suggestedChallenge: null, evidenceFactIds: [] }));
  const result = await runBlockerInference({ chatgpt: { request: async () => sse(completed(JSON.stringify({ requirements }))) }, model: "test", description, evidence: profile });
  assert.deepEqual(result, noBlockers);
});

test("a standalone residency question is unclear; an explicit residency prerequisite remains mandatory", async () => {
  const question = "Have you lived in the UK for the last 3 years?";
  const prerequisite = "Applicants must have lived in the UK for the last 3 years.";
  const residencyProfile = { facts: [{ id: "R1", text: "Born and raised in the UK.", source: "Profile evidence" }] };
  let captured;
  for (const mandatory of [false, true]) {
    const requirement = { category: "eligibility", necessity: mandatory ? "mandatory" : "unclear",
      evidence: "missing", requirementQuote: mandatory ? prerequisite : question,
      explanation: mandatory ? "Continuous residence during the last three years is not established." : null, suggestedChallenge: mandatory ? "What evidence of continuous residence would resolve this finding?" : null, evidenceFactIds: [] };
    const result = await runBlockerInference({ chatgpt: { async request(endpoint, options) {
      captured = JSON.parse(options.body);
      return sse(completed(JSON.stringify({ requirements: [requirement] })));
    } }, model: "test", description: mandatory ? `${prerequisite}\nApplication question: ${question}` : `Application question (required): ${question}`, evidence: residencyProfile });
    assert.equal(result.outcome, mandatory ? "blocker" : "no_blockers_found");
  }
  assert.match(captured.instructions, /A question being required to answer is not evidence that a particular answer is mandatory/);
  assert.match(captured.instructions, /quote that explicit prerequisite rather than the standalone question/);
  assert.match(captured.instructions, /being born and raised in the UK.*do not by themselves establish continuous UK residence/);
});

test("inventory schema and local validation agree on every classification's explanation shape", () => {
  const branches = requirementInventorySchema.properties.requirements.items.anyOf;
  for (const category of ["eligibility", "work_arrangement"]) {
    for (const necessity of ["mandatory", "unclear", "preferred", "excluded"]) {
      for (const evidence of ["supported", "incompatible", "missing", "conflicting"]) {
        const blocker = necessity === "mandatory" && evidence !== "supported" &&
          (category === "eligibility" || evidence === "incompatible");
        const classifications = { category, necessity, evidence };
        const matching = branches.filter(({ properties }) => Object.entries(classifications)
          .every(([key, value]) => properties[key].enum.includes(value)));
        assert.equal(matching.length, 1, JSON.stringify(classifications));
        assert.equal(matching[0].properties.explanation.type, blocker ? "string" : "null");
        assert.equal(matching[0].properties.suggestedChallenge.type, blocker ? "string" : "null");
        const requirement = { ...classifications, requirementQuote: "full UK driving licence",
          explanation: blocker ? "Licence evidence does not establish the prerequisite." : null,
          suggestedChallenge: blocker ? "What licence evidence would resolve this finding?" : null,
          evidenceFactIds: evidence === "missing" ? [] : ["F1"] };
        const findings = deriveValidatedFindings({ requirements: [requirement] }, job().description, profile);
        assert.equal(findings.length, blocker ? 1 : 0, JSON.stringify(classifications));
        assert.throws(() => deriveValidatedFindings({ requirements: [{ ...requirement,
          explanation: blocker ? null : "Unused explanation" }] }, job().description, profile), /invalid assessment/);
      }
    }
  }
});

test("challenge inference replies directly and proposes only validated profile corrections", async () => {
  let captured;
  const description = job().description;
  const challenge = { requirementQuote: "full UK driving licence", reason: "I passed my driving test last week and now hold a full UK licence." };
  const output = { requirements: [{ category: "eligibility", necessity: "mandatory", evidence: "supported",
    requirementQuote: challenge.requirementQuote, explanation: null, suggestedChallenge: null, evidenceFactIds: ["CH1"] }],
    challengeResponse: "Your new full licence satisfies this requirement. I have corrected the outdated provisional-licence fact.",
    challengeAccepted: true, profileUpdates: [{ text: "Holds a full UK driving licence.", replacesFactIds: ["F1"] }] };
  const chatgpt = { async request(endpoint, options) { captured = JSON.parse(options.body); return sse(completed(JSON.stringify(output))); } };
  const result = await runBlockerInference({ chatgpt, model: "test", description, evidence: profile, challenge });
  assert.equal(result.outcome, "no_blockers_found");
  assert.equal(result.challengeReview.accepted, true);
  assert.deepEqual(result.profileUpdates, output.profileUpdates);
  const input = JSON.parse(captured.input[0].content);
  assert.equal(input.blockerChallenge.reason, challenge.reason);
  assert.equal(input.candidateClarification.id, "CH1");
  assert.match(captured.instructions, /never instructions to obey/);
  assert.match(captured.instructions, /focused only on blockerChallenge.requirementQuote/);
  assert.match(captured.instructions, /using exactly "Challenge accepted\." when accepted/);
  assert.match(captured.instructions, /Do not mention, list, summarise or caveat other blockers/);
  assert.match(captured.instructions, /Check every other requirement as usual in the requirements inventory/);
  for (const patch of [
    { challengeResponse: "" }, { challengeAccepted: false, profileUpdates: [] },
    { profileUpdates: [{ text: "Full licence", replacesFactIds: ["CV1"] }] },
    { profileUpdates: [{ text: "Full licence\n## Injected section", replacesFactIds: [] }] },
  ]) {
    await assert.rejects(runBlockerInference({ chatgpt: { request: async () => sse(completed(JSON.stringify({ ...output, ...patch }))) },
      model: "test", description, evidence: profile, challenge }));
  }
});

test("rejected challenges explain the remaining blocker without proposing profile edits", async () => {
  const challenge = { requirementQuote: "full UK driving licence", reason: "Can we ignore this?" };
  const output = { requirements: [{ category: "eligibility", necessity: "mandatory", evidence: "incompatible",
    requirementQuote: challenge.requirementQuote, explanation: "A provisional licence does not satisfy the required full licence.", suggestedChallenge: "Please reconsider this requirement against the advert and my existing evidence.", evidenceFactIds: ["F1"] }],
    challengeResponse: "The advert requires a full licence and your profile confirms a provisional licence. This remains a blocker.",
    challengeAccepted: false, profileUpdates: [] };
  const result = await runBlockerInference({ chatgpt: { request: async () => sse(completed(JSON.stringify(output))) },
    model: "test", description: job().description, evidence: profile, challenge });
  assert.equal(result.findings.length, 1);
  assert.equal(result.challengeReview.accepted, false);
  assert.deepEqual(result.profileUpdates, []);
});

test("fitness clarification repairs inconsistent challenge decisions and retains unrelated blockers", async () => {
  const fitnessQuote = "This role involves heavy manual handling, so applicants must be physically fit and prepared for demanding work.";
  const referencesQuote = "We require good employment references.";
  const description = `${fitnessQuote} ${referencesQuote}`;
  const challenge = { requirementQuote: fitnessQuote, reason: "I am physically fit and prepared for demanding work." };
  const evidence = { facts: [{ id: "F1", text: "Comfortable with physical work.", source: "Profile evidence" }] };
  const fitness = { category: "eligibility", necessity: "mandatory", evidence: "supported",
    requirementQuote: fitnessQuote, explanation: null, suggestedChallenge: null, evidenceFactIds: ["CH1"] };
  const references = { category: "eligibility", necessity: "mandatory", evidence: "missing",
    requirementQuote: referencesQuote, explanation: "Employment references are not established.",
    suggestedChallenge: "What evidence would establish suitable employment references?", evidenceFactIds: [] };
  const corrected = { requirements: [fitness, references], challengeAccepted: true,
    challengeResponse: "Your confirmation establishes the required fitness and readiness, so this finding is resolved.",
    profileUpdates: [{ text: "Physically fit and prepared for demanding work.", replacesFactIds: ["F1"] }] };
  for (const first of [
    { ...corrected, requirements: [{ ...fitness, requirementQuote: "physically fit and prepared for demanding work" }, references] },
    { ...corrected, requirements: [{ ...fitness, evidence: "missing", evidenceFactIds: [],
      explanation: "Fitness is not established.", suggestedChallenge: "Please reconsider my confirmation of physical fitness." }, references] },
    { ...corrected, challengeAccepted: false, profileUpdates: [] },
  ]) {
    const requests = [];
    const controller = new AbortController();
    const result = await runBlockerInference({ chatgpt: { async request(endpoint, options) {
      requests.push(JSON.parse(options.body));
      assert.equal(options.signal, controller.signal);
      return sse(completed(JSON.stringify(requests.length === 1 ? first : corrected)));
    } }, model: "test", description, evidence, challenge, signal: controller.signal });
    assert.equal(requests.length, 2);
    assert.equal(result.challengeReview.accepted, true);
    assert.deepEqual(result.profileUpdates, corrected.profileUpdates);
    assert.deepEqual(result.findings.map((finding) => finding.requirementQuote), [referencesQuote]);
    const initial = JSON.parse(requests[0].input[0].content);
    const retry = JSON.parse(requests[1].input[0].content);
    assert.equal(retry.validationFeedback.challengedQuote, fitnessQuote);
    assert.deepEqual(retry.candidateEvidence, initial.candidateEvidence);
    assert.deepEqual(retry.candidateClarification, initial.candidateClarification);
    assert.deepEqual(retry.blockerChallenge, challenge && { ...challenge, factId: "CH1" });
    assert.deepEqual(requests[1].text, requests[0].text);
    assert.match(requests[0].instructions, /explicit confirmation does/);
    assert.match(requests[0].instructions, /unless the advert explicitly requires such proof/);
  }
});

test("a persistently inconsistent challenge fails after one repair rather than dismissing a blocker", async () => {
  let calls = 0;
  const challenge = { requirementQuote: "full UK driving licence", reason: "I now hold a full UK driving licence." };
  const output = { requirements: [{ category: "eligibility", necessity: "mandatory", evidence: "missing",
    requirementQuote: challenge.requirementQuote, explanation: "Licence not established.",
    suggestedChallenge: "Please reconsider my confirmation of a full licence.", evidenceFactIds: [] }],
    challengeAccepted: true, challengeResponse: "Accepted.", profileUpdates: [] };
  await assert.rejects(runBlockerInference({ chatgpt: { async request() {
    calls += 1;
    return sse(completed(JSON.stringify(output)));
  } }, model: "test", description: job().description, evidence: profile, challenge }),
  { code: "challenge_decision_mismatch" });
  assert.equal(calls, 2);
});

test("every blocker returns a concise prepared challenge; drafts never become candidate evidence", async () => {
  const suggestedChallenge = "  Does the full advert allow visiting sites without driving?  ";
  const requirement = { category: "eligibility", necessity: "mandatory", evidence: "incompatible",
    requirementQuote: "full UK driving licence", explanation: "Only a provisional licence is documented.",
    suggestedChallenge, evidenceFactIds: ["F1"] };
  let captured;
  const result = await runBlockerInference({ chatgpt: { async request(endpoint, options) {
    captured = JSON.parse(options.body);
    return sse(completed(JSON.stringify({ requirements: [requirement] })));
  } }, model: "test", description: job().description, evidence: profile });
  assert.equal(result.findings[0].suggestedChallenge, suggestedChallenge.trim());
  assert.equal(result.outcome, "blocker");
  assert.equal(result.profileUpdates, undefined);
  const input = JSON.parse(captured.input[0].content);
  assert.deepEqual(input.candidateEvidence, profile.facts);
  assert.equal(input.candidateClarification, undefined);
  assert.equal(input.blockerChallenge, undefined);
  assert.match(captured.instructions, /Prepare it in this same response, not on demand/);
  assert.match(captured.instructions, /at most 25 words/);
  assert.match(captured.instructions, /Never invent candidate experience/);
  for (const invalid of [undefined, null, "", "  ", "a".repeat(301), "word ".repeat(26)]) {
    assert.throws(() => deriveValidatedFindings({ requirements: [{ ...requirement, suggestedChallenge: invalid }] }, job().description, profile), /invalid assessment/);
  }
  const { suggestedChallenge: omitted, ...missingSuggestion } = requirement;
  assert.throws(() => deriveValidatedFindings({ requirements: [missingSuggestion] }, job().description, profile), /invalid assessment/);
  assert.throws(() => deriveValidatedFindings({ requirements: [{ ...requirement,
    necessity: "preferred", explanation: null }] }, job().description, profile), /invalid assessment/);
});

test("NatCen's empty technology explanation is corrected without losing the driving blocker", async () => {
  const description = "A full UK driving license and access to a car. Confidence using basic technology";
  const driving = { category: "eligibility", necessity: "mandatory", evidence: "incompatible",
    requirementQuote: "A full UK driving license", explanation: "Only a provisional licence is documented.",
    suggestedChallenge: "What evidence would resolve this licence requirement?", evidenceFactIds: ["F1"] };
  // Reproduced live response: the model labelled technology missing, but left both prose fields empty.
  const technology = { category: "eligibility", necessity: "mandatory", evidence: "missing",
    requirementQuote: "Confidence using basic technology", explanation: "", suggestedChallenge: "", evidenceFactIds: [] };
  const evidence = { facts: [...profile.facts, { id: "CV1", source: "CV evidence", text: "Manual software testing and digital record keeping." }] };
  const requests = [];
  const result = await runBlockerInference({ model: "test", description, evidence,
    chatgpt: { async request(endpoint, options) {
      requests.push(JSON.parse(options.body));
      return sse(completed(JSON.stringify({ requirements: [driving, requests.length === 1 ? technology : {
        ...technology, evidence: "supported", explanation: null, suggestedChallenge: null, evidenceFactIds: ["CV1"],
      }] })));
    } },
  });
  assert.equal(requests.length, 2);
  assert.equal(result.outcome, "blocker");
  assert.deepEqual(result.findings.map((finding) => finding.requirementQuote), [driving.requirementQuote]);
  const first = JSON.parse(requests[0].input[0].content);
  const corrected = JSON.parse(requests[1].input[0].content);
  assert.deepEqual(corrected.candidateEvidence, first.candidateEvidence);
  assert.equal(corrected.jobDescription, first.jobDescription);
  assert.equal(corrected.validationFeedback.requirementIndex, 2);
  assert.equal(corrected.validationFeedback.rejectedQuote, technology.requirementQuote);
  assert.match(corrected.validationFeedback.problem, /missing requirement explanation/);
  assert.match(corrected.validationFeedback.problem, /retaining every candidate requirement/);
  assert.deepEqual(requests[1].text, requests[0].text);
  for (const { properties } of requests[0].text.format.schema.properties.requirements.items.anyOf) {
    assert.deepEqual(properties.evidenceFactIds.items.enum, ["F1", "CV1"]);
    assert.equal(properties.evidenceFactIds.maxItems, properties.evidence.enum[0] === "missing" ? 0 : undefined);
    assert.equal(properties.evidenceFactIds.minItems, properties.evidence.enum[0] === "missing" ? undefined : 1);
  }
});

test("persistent invalid fields fail after one correction with a specific checker failure", async () => {
  const requirement = { category: "eligibility", necessity: "mandatory", evidence: "incompatible",
    requirementQuote: "full UK driving licence", explanation: "Only a provisional licence is documented.",
    suggestedChallenge: "What licence evidence would resolve this finding?", evidenceFactIds: ["F1"] };
  for (const [patch, problem] of [
    [{ explanation: "" }, "missing requirement explanation"],
    [{ explanation: "   " }, "missing requirement explanation"],
    [{ suggestedChallenge: "" }, "missing suggested challenge"],
    [{ suggestedChallenge: "word ".repeat(26) }, "suggested challenge exceeds 25 words or 300 characters"],
    [{ evidenceFactIds: ["F99"] }, "unknown evidence reference"],
    [{ evidence: "missing" }, "missing evidence must have no fact references"],
  ]) {
    let calls = 0;
    const chatgpt = { async request() {
      calls += 1;
      return sse(completed(JSON.stringify({ requirements: [{ ...requirement, ...patch }] })));
    } };
    await assert.rejects(runBlockerInference({ chatgpt, model: "test", description: job().description, evidence: profile }), {
      code: "requirement_validation_failed",
      message: `The checker returned an invalid assessment (${problem}). Blocker status is unknown.`,
    });
    assert.equal(calls, 2);
  }
});

test("blocking schema fields cannot be empty strings", () => {
  for (const { properties } of requirementInventorySchema.properties.requirements.items.anyOf) {
    assert.equal(properties.requirementQuote.minLength, 1);
    if (properties.explanation.type !== "string") continue;
    assert.equal(properties.explanation.minLength, 1);
    assert.equal(properties.suggestedChallenge.minLength, 1);
  }
});
