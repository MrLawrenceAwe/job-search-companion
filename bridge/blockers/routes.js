import { readJsonBody } from "../http-helpers.js";

export const createBlockerRoutes = ({ checker, chatgpt }) => async (req, respond) => {
  if (!req.url?.startsWith("/blockers/")) return false;
  try {
    const body = req.method === "POST" ? await readJsonBody(req, 100_000) : {};
    const route = `${req.method} ${req.url}`;
    let result;
    if (route === "GET /blockers/status") result = await checker.status();
    else if (route === "GET /blockers/models") result = { models: await chatgpt.models() };
    else if (route === "POST /blockers/settings") result = await checker.configure(body);
    else if (route === "POST /blockers/sign-in") { await checker.accountChanged(); result = await chatgpt.signIn(body); }
    else if (route === "POST /blockers/cancel-sign-in") { chatgpt.cancelLogin(); result = await checker.status(); }
    else if (route === "POST /blockers/account") { await checker.accountChanged(); await chatgpt.select(body.id); result = await checker.status(); }
    else if (route === "POST /blockers/sign-out") { await checker.accountChanged(); await chatgpt.logout(); result = await checker.status(); }
    else if (route === "POST /blockers/clear-cache") { await checker.clearCache(); result = await checker.status(); }
    else if (route === "POST /blockers/checks") result = { check: await checker.start(body) };
    else if (req.method === "GET" && /^\/blockers\/checks\/[a-f0-9-]{36}$/.test(req.url)) result = { check: checker.get(req.url.split("/").at(-1)) };
    else { respond(404, { ok: false, error: "Not found" }); return true; }
    respond(200, { ok: true, ...result });
  } catch (error) {
    respond(error.name === "RequestBodyTooLargeError" ? 413 : error.status || 400, { ok: false, error: error.message, code: error.code || "invalid_request" });
  }
  return true;
};
