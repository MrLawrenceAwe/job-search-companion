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
