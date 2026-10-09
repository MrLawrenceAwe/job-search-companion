import { config } from "../config.js";
import { fileURLToPath } from "node:url";
import { jobAnalysisContract } from "../../shared/contracts.js";

const NEW_TASK_DEEP_LINK = "codex://threads/new";

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
export const createTaskPrompt = (jobUrl, completion) => {
  const assessment = `$cv-fit-advisor\n${jobUrl}`;
  const script = fileURLToPath(new URL("../../scripts/complete-analysis.js", import.meta.url));
  const command = [process.execPath, script, completion.id, completion.token].map(shellQuote).join(" ");
  return `${assessment}\n\nJob Search Companion completion:\nOnce the CV-fit assessment is ready, immediately before your final answer, run this shell command to save the analysed mark, verdict, and this chat's Open analysis link. Replace VERDICT with your exact final Verdict value, preserving the single quotes:\n${command} 'VERDICT'\nAllowed verdicts: ${jobAnalysisContract.verdicts.map((verdict) => JSON.stringify(verdict)).join(", ")}. The helper reads CODEX_THREAD_ID from your environment. Do not guess or substitute another chat ID. Only report completion after an assessment has been produced (including an evidence-based negative verdict); do not run it if the task was cancelled or the posting could not be assessed. If the callback fails, still deliver the assessment and briefly say the analysed mark could not be saved. This callback is authorized as part of this job analysis.`;
};

export const createTaskDeepLink = ({ jobUrl, completion, workspacePath = config.cvFit.workspacePath }) => {
  const deepLink = new URL(NEW_TASK_DEEP_LINK);
  deepLink.searchParams.set("path", workspacePath);
  deepLink.searchParams.set("prompt", createTaskPrompt(jobUrl, completion));
  return deepLink.href;
};
