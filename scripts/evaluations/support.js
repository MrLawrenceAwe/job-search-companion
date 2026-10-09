import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { blockerSources } from "../../shared/blocker-sources.js";
import { blockerContract } from "../../shared/contracts.js";
import { sha256 } from "../../shared/sha256.js";
import { readVerifiedProfile } from "../../bridge/blockers/profile.js";
import { blockerInstructions } from "../../bridge/blockers/inference.js";
import { cvIndexInstructions, cvIndexVersion } from "../../bridge/blockers/cv-index.js";

export const evaluationVersions = Object.freeze({
  checkerVersion: blockerContract.version,
  blockerPromptHash: sha256(blockerInstructions),
  cvIndexVersion,
  cvIndexPromptHash: sha256(cvIndexInstructions),
});
export const readEvaluationProfile = () => readVerifiedProfile(blockerSources().profileSources);

// Evaluation never refreshes tokens or changes the account selected by the bridge.
export const createEvaluationClient = ({
  accountPath = join(blockerSources().directory, "chatgpt.json"),
  fetchImpl = fetch,
} = {}) => ({
  async request(endpoint, options = {}) {
    const state = JSON.parse(await readFile(accountPath, "utf8"));
    const account = state.accounts.find((entry) => entry.id === state.activeId);
    if (!account?.accessToken || account.expiresAt <= Date.now() + 60_000)
      throw new Error("Refresh the connected account through extension settings before evaluating.");
    const response = await fetchImpl(`https://api.openai.com/v1/${endpoint}`, {
      ...options,
      signal: options.signal || AbortSignal.timeout(90_000),
      headers: { ...options.headers, Authorization: `Bearer ${account.accessToken}` },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(`Evaluation request failed: ${response.status} ${body.error?.code || "unknown"}`);
    }
    return response;
  },
});

export const writeEvaluationReport = async (name, report, directory = new URL("../../docs/evaluations/", import.meta.url)) => {
  const timestamp = report.measuredAt.replace(/[:.]/g, "-");
  const path = new URL(`${timestamp}-${name}.json`, directory);
  await mkdir(directory, { recursive: true });
  await writeFile(path, JSON.stringify({ ...report, ...evaluationVersions }, null, 2) + "\n", { flag: "wx" });
  return path;
};
