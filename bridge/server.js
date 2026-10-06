import { createServer } from "node:http";

import { readAccessibilityHelperHealth } from "./codex/helper-health.js";
import { submitCvFitTask } from "./codex/task-runner.js";
import { config } from "./config.js";
import { createRequestHandler } from "./request-handler.js";
import { createFileLogger } from "./logger.js";
import { openSubmissionStore } from "./submission-store.js";

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
    requestHandler = createRequestHandler({
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
