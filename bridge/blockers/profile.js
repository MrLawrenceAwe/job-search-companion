import { readFile } from "node:fs/promises";
import { hashJson } from "../../shared/sha256.js";

const applicationSections = new Set([
  "Personal Constraints",
  "Location And Availability",
  "Location, Travel And Shift Constraints",
  "Education",
]);
const verifiedGroups = new Set([
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

export const readVerifiedProfile = async (profileSources) => {
  const facts = [];
  const sources = [];
  for (const { kind, path } of profileSources) {
    if (!["application", "verified"].includes(kind))
      throw new Error(`Unknown profile source kind: ${kind}`);
    const name = kind === "application" ? "Application profile" : "Verified application profile";
    const text = await readFile(path, "utf8");
    let section = "";
    let group = "";
    for (const raw of text.split(/\r?\n/)) {
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
      const allowed =
        kind === "application"
          ? applicationSections.has(section)
          : (section === "Facts" && verifiedGroups.has(group)) ||
            preferencePrefixes.some((prefix) => line.startsWith(prefix));
      if (allowed && line.startsWith("- "))
        facts.push({
          id: `F${facts.length + 1}`,
          text: line.slice(2),
          source: name,
        });
    }
    sources.push({
      name,
      path,
    });
  }
  if (!facts.length)
    throw new Error(
      "The verified profile has no supported facts. Check the configured profile files.",
    );
  return { facts, sources, hash: hashJson(facts) };
};
