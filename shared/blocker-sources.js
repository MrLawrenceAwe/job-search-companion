import { homedir } from "node:os";
import { join } from "node:path";
import { dataDirectory } from "./data-directory.js";

export const blockerSources = (homePath = homedir()) => ({
  directory: join(dataDirectory(homePath), "blockers"),
  cvDirectory: join(homePath, "Job Hunting"),
  profileSources: [
    { kind: "application", path: join(homePath, "Job Hunting/profile.md") },
    { kind: "verified", path: join(homePath, ".codex/skills/apply-to-jobs/references/profile.md") },
  ],
});
