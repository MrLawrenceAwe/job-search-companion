import { jobAnalysisContract } from "../shared/contracts.js";
import { runCommand } from "./run-command.js";
import { readJsonBody, RequestBodyTooLargeError } from "./http-helpers.js";

const handleCompletion = async (req, respond, store) => {
  const match = req.method === "POST" && req.url?.match(/^\/analyses\/([a-f0-9-]{36})\/complete$/);
  if (!match) return false;
  try {
    const { threadId, verdict } = await readJsonBody(req);
    const analysis = await store.complete({ id: match[1], token: req.headers["x-jsc-analysis-token"], threadId, verdict });
    respond(200, { ok: true, analysis });
  } catch (error) {
    respond(error instanceof RequestBodyTooLargeError ? 413 : 400, { ok: false, error: error.message });
  }
  return true;
};

export const createAnalysisRoutes = ({
  analysisStore,
  openAnalysis = (threadId) => runCommand("/usr/bin/open", [jobAnalysisContract.linkFor(threadId)], { timeoutMs: 10_000 }),
}) => ({
  // Completion is dispatched after the origin check, before general-token authentication.
  handleCompletion: (req, respond) => handleCompletion(req, respond, analysisStore),
  async handleAuthenticated(req, respond) {
    if (req.method === "GET" && req.url === "/analyses") {
      respond(200, { ok: true, analyses: analysisStore.list() });
      return true;
    }
    if (req.method !== "POST" || req.url !== "/analyses/open") return false;
    try {
      const { jobUrl } = await readJsonBody(req);
      const key = jobAnalysisContract.keyFor(jobUrl);
      const analysis = analysisStore.list().find((record) => jobAnalysisContract.keyFor(record.jobUrl) === key);
      if (!analysis) {
        respond(404, { ok: false, error: "No completed analysis for this job" });
        return true;
      }
      await openAnalysis(analysis.threadId);
      respond(200, { ok: true });
    } catch (error) {
      respond(error instanceof RequestBodyTooLargeError ? 413 : 400, { ok: false, error: error.message });
    }
    return true;
  },
});
