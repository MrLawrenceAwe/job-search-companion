import { createServer } from "node:http";

import { readAccessibilityHelperHealth } from "./codex/helper-health.js";
import { submitCvFitTask } from "./codex/task-runner.js";
import { config } from "./config.js";
import { createRequestHandler } from "./request-handler.js";
import { createFileLogger } from "./logger.js";
import { openSubmissionStore } from "./submission-store.js";

import { openChatGPT } from "./blockers/chatgpt.js";
import { openBlockerChecker } from "./blockers/checker.js";
import { createBlockerRoutes } from "./blockers/routes.js";
import { join } from "node:path";

let checker = null;
const logger = createFileLogger(config.storage.logPath);
let requestHandler = null;
const server = createServer((req, res) => {
  if (!requestHandler) {
    res.writeHead(503);
    res.end();
    return;
  }
  void requestHandler(req, res);
});

server.listen(config.bridge.port, config.bridge.host, async () => {
  try {
    const submissionStore = await openSubmissionStore(config.storage.submissionsPath);
    const chatgpt = await openChatGPT({ path: join(config.blockers.directory, "chatgpt.json") });
    checker = await openBlockerChecker({ ...config.blockers, chatgpt });
    requestHandler = createRequestHandler({
      blockerRoutes: createBlockerRoutes({ checker, chatgpt }),
      bridgeConfig: config.bridge,
      cvFitConfig: config.cvFit,
      logger,
      readHelperHealth: readAccessibilityHelperHealth,
      submitTask: submitCvFitTask,
      submissionStore,
    });
    logger.info(`Job Search Companion service listening on http://${config.bridge.host}:${config.bridge.port}`);
    logger.info(`Workspace: ${config.cvFit.workspacePath}`);
  } catch (error) {
    logger.error("Job Search Companion could not load submission statuses:", error);
    server.close();
    process.exitCode = 1;
  }
});

server.on("error", (error) => {
  logger.error("Job Search Companion service error:", error);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { checker?.close(); server.close(() => process.exit(0)); });
}
