import assert from "node:assert/strict";
import test from "node:test";
import { requirementClasses, classificationFor, findingPolicyDescription } from "../../../bridge/blockers/requirement-policy.js";
import { blockerInstructions } from "../../../bridge/blockers/inference-prompts.js";
import { createRequirementInventorySchema } from "../../../bridge/blockers/inference-schemas.js";

test("prompt and schema describe the same complete, disjoint classification policy", () => {
  assert.ok(blockerInstructions.includes(findingPolicyDescription));
  assert.equal(findingPolicyDescription.split("\n").length, requirementClasses.length + 1);
  const branches = createRequirementInventorySchema(["F1"]).properties.requirements.items.anyOf;
  for (const category of ["eligibility", "work_arrangement"])
    for (const necessity of ["mandatory", "unclear", "preferred", "excluded"])
      for (const evidence of ["supported", "incompatible", "missing", "conflicting"]) {
        const classification = classificationFor({ category, necessity, evidence });
        assert.ok(classification);
        const matching = branches.filter(({ properties }) =>
          properties.category.enum.includes(category) && properties.necessity.enum.includes(necessity) &&
          properties.evidence.enum.includes(evidence));
        assert.equal(matching.length, 1);
        assert.equal(matching[0].properties.explanation.type, classification.producesFinding ? "string" : "null");
      }
});
