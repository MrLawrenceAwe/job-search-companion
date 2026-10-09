import { cvFitSubmissionContract, jobAnalysisContract } from "../shared/contracts.js";
import { randomUUID } from "node:crypto";

import {
  readJsonBody,
  RequestBodyTooLargeError,
  isRequestOriginAllowed,
  isRequestTokenValid,
  sendJson,
} from "./http-helpers.js";
import { normalizeJobUrl } from "./job-url.js";
import { handleAnalysisCompletion } from "./analysis-routes.js";
import { runCommand } from "./run-command.js";

const { statuses } = cvFitSubmissionContract;

export const createRequestHandler = ({
  bridgeConfig,
  cvFitConfig,
  logger,
  readHelperHealth,
  submitTask,
  submissionStore,
  analysisStore,
  openAnalysis = (threadId) => runCommand("/usr/bin/open", [jobAnalysisContract.linkFor(threadId)], { timeoutMs: 10_000 }),
  createSubmissionId = randomUUID,
  blockerRoutes = null,
}) => {
  const { submissions } = submissionStore;
  let activeSubmissionId = null;
  const maximumCompletedSubmissions = 50;

  const pruneCompletedSubmissions = () => {
    const completedIds = [...submissions]
      .filter(([, submission]) => submission.status !== statuses.submitting)
      .map(([id]) => id);
    for (const id of completedIds.slice(0, -maximumCompletedSubmissions)) {
      submissions.delete(id);
    }
  };

  const runSubmission = async (submissionId, jobUrl, completion) => {
    let completedSubmission;
    try {
      const { status } = await submitTask({ jobUrl, completion });
      completedSubmission = { id: submissionId, status };
      logger.info(`CV Fit task automation completed: ${completedSubmission.status}`);
    } catch (error) {
      completedSubmission = {
        id: submissionId,
        status: statuses.failed,
        error: error instanceof Error ? error.message : String(error),
      };
      logger.warn(`CV Fit task submission failed: ${completedSubmission.error}`);
    } finally {
      submissions.set(submissionId, completedSubmission);
      pruneCompletedSubmissions();
      try {
        await submissionStore.save();
      } catch (error) {
        logger.error("Could not persist completed CV Fit task submission:", error);
      }
      if (activeSubmissionId === submissionId) {
        activeSubmissionId = null;
      }
    }
  };

  return async (req, res) => {
    const respond = (statusCode, payload) => sendJson(req, res, statusCode, payload, {
      allowedOrigin: bridgeConfig.allowedExtensionOrigin,
    });

    if (!isRequestOriginAllowed(req, bridgeConfig.allowedExtensionOrigin)) {
      respond(403, { ok: false, error: "Origin is not allowed" });
      return;
    }
    if (req.method === "OPTIONS") {
      respond(204, {});
      return;
    }
    // Scoped completion callbacks do not expose the extension's general bridge credential.
    if (await handleAnalysisCompletion(req, respond, analysisStore)) return;
    if (!isRequestTokenValid(req, bridgeConfig.token)) {
      respond(403, { ok: false, error: "Bridge token is invalid" });
      return;
    }
    if (req.method === "GET" && req.url === "/analyses") {
      respond(200, { ok: true, analyses: analysisStore.list() });
      return;
    }
    if (req.method === "POST" && req.url === "/analyses/open") {
      try {
        const { jobUrl } = await readJsonBody(req);
        const key = jobAnalysisContract.keyFor(jobUrl);
        const analysis = analysisStore.list().find((record) => jobAnalysisContract.keyFor(record.jobUrl) === key);
        if (!analysis) { respond(404, { ok: false, error: "No completed analysis for this job" }); return; }
        await openAnalysis(analysis.threadId);
        respond(200, { ok: true });
      } catch (error) {
        respond(error instanceof RequestBodyTooLargeError ? 413 : 400, { ok: false, error: error.message });
      }
      return;
    }

    if (blockerRoutes && await blockerRoutes(req, respond)) return;

    if (req.method === "GET" && req.url === "/health") {
      const accessibilityHelper = await readHelperHealth();
      respond(accessibilityHelper.ready ? 200 : 503, {
        ok: accessibilityHelper.ready,
        service: bridgeConfig.name,
        version: bridgeConfig.version,
        instanceId: bridgeConfig.instanceId,
        workspace: cvFitConfig.workspacePath,
        requiredSettings: cvFitConfig.settings.map(({ category, label }) => ({ category, label })),
        accessibilityHelper,
        port: bridgeConfig.port,
      });
      return;
    }

    const statusMatch = req.method === "GET"
      ? req.url?.match(/^\/cv-fit-submissions\/([^/?]+)$/)
      : null;
    if (statusMatch) {
      let submissionId;
      try {
        submissionId = decodeURIComponent(statusMatch[1]);
      } catch {
        respond(400, { ok: false, error: "Submission ID is invalid" });
        return;
      }
      const submission = submissions.get(submissionId);
      respond(
        submission ? 200 : 404,
        submission
          ? { ok: true, submission }
          : { ok: false, error: "Submission not found" },
      );
      return;
    }

    if (req.method !== "POST" || req.url !== "/cv-fit-submissions") {
      respond(404, { ok: false, error: "Not found" });
      return;
    }
    let jobUrl;
    try {
      const { jobUrl: rawJobUrl } = await readJsonBody(req);
      jobUrl = normalizeJobUrl(rawJobUrl);
    } catch (error) {
      logger.warn(`CV Fit task request rejected: ${error.message}`);
      respond(error instanceof RequestBodyTooLargeError ? 413 : 400, {
        ok: false,
        error: error.message,
      });
      return;
    }

    if (activeSubmissionId !== null) {
      respond(409, { ok: false, error: "A CV Fit Advisor task is already being submitted in Codex" });
      return;
    }

    const submissionId = createSubmissionId();
    const submission = { id: submissionId, status: statuses.submitting };
    submissions.set(submissionId, submission);
    activeSubmissionId = submissionId;
    let completion;
    try {
      await submissionStore.save();
      completion = await analysisStore.create({ id: submissionId, jobUrl });
    } catch (error) {
      submissions.delete(submissionId);
      activeSubmissionId = null;
      logger.error("Could not persist CV Fit task submission:", error);
      respond(503, { ok: false, error: "Could not save the submission status" });
      return;
    }
    logger.info("CV Fit task submission started");
    void runSubmission(submissionId, jobUrl, completion);
    respond(202, { ok: true, submission });
  };
};
