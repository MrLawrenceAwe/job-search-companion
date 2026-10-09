import { readJsonBody, RequestBodyTooLargeError } from "./http-helpers.js";

export const handleAnalysisCompletion = async (req, respond, store) => {
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
