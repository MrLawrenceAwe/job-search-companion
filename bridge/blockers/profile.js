import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export const digest = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const applicationSections = new Set(["Personal Constraints", "Location And Availability", "Location, Travel And Shift Constraints", "Education"]);
const verifiedGroups = new Set(["Eligibility", "Employment status", "Driving", "Experience notes", "Employment history", "Education", "Certifications"]);
const preferencePrefixes = ["- Shift-hours preference:", "- Location preference:", "- Relocation:", "- London travel boundary:", "- Commute fit:"];

export const readVerifiedProfile = async (paths) => {
  const facts = [];
  const sources = [];
  for (const [index, path] of paths.entries()) {
    const text = await readFile(path, "utf8");
    let section = ""; let group = "";
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith("## ")) { section = line.slice(3); group = ""; continue; }
      if (/^[A-Za-z][^:]+:$/.test(line)) { group = line.slice(0, -1); continue; }
      const allowed = index === 0 ? applicationSections.has(section)
        : (section === "Facts" && verifiedGroups.has(group)) || preferencePrefixes.some((prefix) => line.startsWith(prefix));
      if (allowed && line.startsWith("- ")) facts.push({ id: `F${facts.length + 1}`, text: line.slice(2), source: index === 0 ? "Application profile" : "Verified application profile" });
    }
    sources.push({ name: index === 0 ? "Application profile" : "Verified application profile", path });
  }
  if (!facts.length) throw new Error("The verified profile has no supported facts. Check the configured profile files.");
  return { facts, sources, hash: digest(facts) };
};
