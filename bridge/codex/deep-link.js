import { config } from "../config.js";

const NEW_TASK_DEEP_LINK = "codex://threads/new";

export const createTaskPrompt = (jobUrl) => `$cv-fit-advisor\n${jobUrl}`;

export const createTaskDeepLink = ({ jobUrl, workspacePath = config.cvFit.workspacePath }) => {
  const deepLink = new URL(NEW_TASK_DEEP_LINK);
  deepLink.searchParams.set("path", workspacePath);
  deepLink.searchParams.set("prompt", createTaskPrompt(jobUrl));
  return deepLink.href;
};
