import { readFile } from "node:fs/promises";
import { atomicWrite } from "../../shared/filesystem.js";
import { hashJson } from "../../shared/sha256.js";

const applicationSections = new Set([
  "Personal Constraints",
  "Location And Availability",
  "Location, Travel And Shift Constraints",
  "Education",
]);
const skillProfileGroups = new Set([
  "Eligibility",
  "Employment status",
  "Driving",
  "Experience notes",
  "Employment history",
  "Education",
  "Certifications",
]);
const preferencePrefixes = [
  "- Shift-hours preference:",
  "- Location preference:",
  "- Relocation:",
  "- London travel boundary:",
  "- Commute fit:",
];

export const readProfileEvidence = async (profileSources) => {
  const facts = [];
  const sources = [];
  const snapshots = {};
  const factLocations = {};
  for (const { kind, path } of profileSources) {
    if (!["application", "skill"].includes(kind))
      throw new Error(`Unknown profile source kind: ${kind}`);
    const name = kind === "application" ? "Application profile" : "Application skill profile";
    const text = await readFile(path, "utf8");
    snapshots[path] = text;
    let section = "";
    let group = "";
    for (const [lineIndex, raw] of text.split(/\r?\n/).entries()) {
      const line = raw.trim();
      if (line.startsWith("## ")) {
        section = line.slice(3);
        group = "";
        continue;
      }
      if (/^[A-Za-z][^:]+:$/.test(line)) {
        group = line.slice(0, -1);
        continue;
      }
      const allowed = section === "Blocker-check clarifications" ||
        (kind === "application"
          ? applicationSections.has(section)
          : (section === "Facts" && skillProfileGroups.has(group)) ||
            preferencePrefixes.some((prefix) => line.startsWith(prefix)));
      if (allowed && line.startsWith("- ")) {
        factLocations[`F${facts.length + 1}`] = { path, lineIndex };
        facts.push({
          id: `F${facts.length + 1}`,
          text: line.slice(2),
          source: name,
        });
      }
    }
    sources.push({
      name,
      path,
    });
  }
  if (!facts.length)
    throw new Error(
      "The profile evidence has no supported facts. Check the configured profile files.",
    );
  return { facts, sources, hash: hashJson(facts), snapshots, factLocations };
};

// Integrate accepted facts, replacing superseded facts rather than keeping challenge history.
export const integrateProfileUpdates = async ({ profile, updates, profileSources, isCurrent = () => true }) => {
  if (!updates.length) return;
  const target = profileSources.find((source) => source.kind === "application") || profileSources[0];
  if (!target || !profile.snapshots || !profile.factLocations)
    throw new Error("Profile cannot be updated from this snapshot. Retry the challenge.");
  const replacements = new Map(Object.entries(profile.snapshots).map(([path, text]) => [path, text.split(/\r?\n/)]));
  const removed = new Set();
  for (const update of updates) {
    for (const id of update.replacesFactIds) {
      const location = profile.factLocations[id];
      if (!location || removed.has(id)) throw new Error("Invalid profile correction");
      replacements.get(location.path)[location.lineIndex] = null;
      removed.add(id);
    }
  }
  const targetLines = replacements.get(target.path);
  const additions = [...new Set(updates.map((update) => update.text.trim()))]
    .filter((text) => !profile.facts.some((fact) => !removed.has(fact.id) && fact.text === text))
    .map((text) => `- ${text}`);
  if (additions.length) {
    const section = targetLines.indexOf("## Blocker-check clarifications");
    if (section < 0) targetLines.push("", "## Blocker-check clarifications", "", ...additions);
    else targetLines.splice(section + 1, 0, ...additions);
  }
  const changes = [...replacements].map(([path, lines]) => ({ path, original: profile.snapshots[path],
    text: lines.filter((line) => line !== null).join("\n") })).filter(({ original, text }) => original !== text);
  // Verify the entire snapshot so a concurrent human edit is never overwritten.
  for (const [path, original] of Object.entries(profile.snapshots))
    if (await readFile(path, "utf8") !== original) throw new Error("Profile changed during review. Retry the challenge.");
  const written = [];
  try {
    for (const change of changes) {
      if (!isCurrent()) throw new Error("Challenge interrupted before profile update.");
      if (await readFile(change.path, "utf8") !== change.original) throw new Error("Profile changed during review. Retry the challenge.");
      await atomicWrite(change.path, change.text);
      written.push(change);
    }
    if (!isCurrent()) throw new Error("Challenge interrupted during profile update.");
  } catch (error) {
    for (const change of written.reverse())
      if (await readFile(change.path, "utf8") === change.text) await atomicWrite(change.path, change.original);
    throw error;
  }
};
