import {
  readJsonBody,
  RequestBodyTooLargeError,
  isRequestOriginAllowed,
  isRequestTokenValid,
  sendJson,
} from "./http-helpers.js";
import { normalizeJobUrl } from "./job-url.js";
import { createAnalysisRoutes } from "./analysis-routes.js";
import { createCvFitSubmissionService } from "./cv-fit-submission-service.js";

export const createRequestHandler = ({
  bridgeConfig,
  cvFitConfig,
  logger,
  readHelperHealth,
  submitTask,
  submissionStore,
  analysisStore,
  openAnalysis,
  createSubmissionId,
  blockerRoutes = null,
}) => {
  const submissionService = createCvFitSubmissionService({
    submissionStore, analysisStore, submitTask, logger, createSubmissionId,
  });
  const analysisRoutes = createAnalysisRoutes({ analysisStore, openAnalysis });

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
    if (await analysisRoutes.handleCompletion(req, respond)) return;
    if (!isRequestTokenValid(req, bridgeConfig.token)) {
      respond(403, { ok: false, error: "Bridge token is invalid" });
      return;
    }
    if (await analysisRoutes.handleAuthenticated(req, respond)) return;

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
      const submission = submissionService.get(submissionId);
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

    try {
      const submission = await submissionService.start(jobUrl);
      respond(202, { ok: true, submission });
    } catch (error) {
      respond(error.status || 500, { ok: false, error: error.message });
    }
  };
};
