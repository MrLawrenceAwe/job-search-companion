import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVerifiedProfile } from "../../../bridge/blockers/profile.js";

test("profile snapshot selects relevant facts while excluding contact and sensitive data", async () => {
  const { writeFile } = await import("node:fs/promises");
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-profile-"));
  const p1 = join(directory, "application.md"); const p2 = join(directory, "verified.md");
  await writeFile(p1, "## Personal Constraints\n- Provisional licence only.\n## Education\n- BSc Computer Science.\n");
  await writeFile(p2, "## Facts\nContact:\n- Email: private@example.test.\nEligibility:\n- UK background: born and raised in the UK.\nDriving:\n- Driving licence: provisional.\nIdentity and disclosure facts:\n- Religion: private.\n## Preferences\n- Relocation: ask per job.\n- Cover letters: short.\n");
  const profileSources = [{ kind: "application", path: p1 }, { kind: "verified", path: p2 }];
  const result = await readVerifiedProfile(profileSources);
  const reversed = await readVerifiedProfile([...profileSources].reverse());
  const sourceFacts = (profile) => profile.facts.map(({ text, source }) => ({ text, source }))
    .sort((left, right) => left.text.localeCompare(right.text));
  assert.deepEqual(sourceFacts(reversed), sourceFacts(result));
  await assert.rejects(readVerifiedProfile([{ kind: "unknown", path: p1 }]), /Unknown profile source kind/);
  assert.equal(result.facts.length, 5); assert.doesNotMatch(JSON.stringify(result.facts), /private|Cover letters/);
  assert.ok(result.facts.some(({ text }) => text === "UK background: born and raised in the UK."));
});

test("accepted corrections replace superseded facts across profiles without keeping challenge history", async () => {
  const { writeFile, readFile } = await import("node:fs/promises");
  const { integrateProfileUpdates } = await import("../../../bridge/blockers/profile.js");
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-correction-"));
  const p1 = join(directory, "application.md"), p2 = join(directory, "verified.md");
  await writeFile(p1, "# Profile\n## Personal Constraints\n- Provisional licence only.\n## Education\n- BSc Computer Science.\n");
  await writeFile(p2, "## Facts\nDriving:\n- Driving licence: provisional.\nContact:\n- Email: private@example.test.\n");
  const profileSources = [{ kind: "application", path: p1 }, { kind: "verified", path: p2 }];
  const profile = await readVerifiedProfile(profileSources);
  const updates = [{ text: "Holds a full UK driving licence.", replacesFactIds: ["F1", "F3"] }];
  await integrateProfileUpdates({ profile, updates, profileSources });
  const updated = await readVerifiedProfile(profileSources);
  assert.deepEqual(updated.facts.map(({ text }) => text), ["BSc Computer Science.", "Holds a full UK driving licence."]);
  assert.notEqual(updated.hash, profile.hash);
  assert.match(await readFile(p2, "utf8"), /Email: private@example.test/);
  const before = await readFile(p1, "utf8");
  await integrateProfileUpdates({ profile: updated, updates: [{ ...updates[0], replacesFactIds: [] }], profileSources });
  assert.equal(await readFile(p1, "utf8"), before);
  await assert.rejects(integrateProfileUpdates({ profile, updates, profileSources }), /Profile changed/);
  assert.equal(await readFile(p1, "utf8"), before);
});

test("interrupted integration restores source files instead of leaving partial corrections", async () => {
  const { writeFile, readFile } = await import("node:fs/promises");
  const { integrateProfileUpdates } = await import("../../../bridge/blockers/profile.js");
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-correction-"));
  const path = join(directory, "application.md");
  const original = "## Personal Constraints\n- Provisional licence only.\n";
  await writeFile(path, original);
  const profileSources = [{ kind: "application", path }];
  const profile = await readVerifiedProfile(profileSources);
  let checks = 0;
  await assert.rejects(integrateProfileUpdates({ profile, profileSources,
    updates: [{ text: "Full UK driving licence.", replacesFactIds: ["F1"] }], isCurrent: () => ++checks < 2 }), /interrupted/);
  assert.equal(await readFile(path, "utf8"), original);
});
