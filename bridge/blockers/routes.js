import { identifierContract } from "../../shared/contracts.js";
import { readJsonBody } from "../http-helpers.js";

export const createBlockerRoutes =
  ({ checker, chatgpt }) =>
  async (req, respond, res) => {
    if (!req.url?.startsWith("/blockers/")) return false;
    try {
      const body = req.method === "POST" ? await readJsonBody(req, 100_000) : {};
      const route = `${req.method} ${req.url}`;
      const checkMatch = req.method === "GET" && req.url.match(/^\/blockers\/checks\/([^/?]+)$/);
      let result;
      if (route === "GET /blockers/status") result = await checker.status();
      else if (route === "GET /blockers/models") result = { models: await chatgpt.models() };
      else if (route === "POST /blockers/settings") result = await checker.configure(body);
      else if (route === "POST /blockers/sign-in") {
        await checker.resetForAccountChange();
        result = await chatgpt.signIn(body);
      } else if (route === "POST /blockers/cancel-sign-in") {
        chatgpt.cancelSignIn();
        result = await checker.status();
      } else if (route === "POST /blockers/account") {
        await checker.resetForAccountChange();
        await chatgpt.select(body.id);
        result = await checker.status();
      } else if (route === "POST /blockers/sign-out") {
        await checker.resetForAccountChange();
        await chatgpt.logout();
        result = await checker.status();
      } else if (route === "POST /blockers/clear-cache") {
        await checker.clearCache();
        result = await checker.status();
      } else if (route === "POST /blockers/checks") result = { check: await checker.start(body) };
      else if (checkMatch) {
        const id = checkMatch[1];
        if (!identifierContract.isUuid(id)) throw new Error("Invalid check ID");
        const controller = new AbortController();
        const disconnect = () => controller.abort();
        res.once("close", disconnect);
        if (res.destroyed) disconnect();
        try {
          result = { check: await checker.wait(id, { signal: controller.signal }) };
        } finally {
          res.removeListener("close", disconnect);
        }
      } else {
        respond(404, { ok: false, error: "Not found" });
        return true;
      }
      respond(200, { ok: true, ...result });
    } catch (error) {
      if (res.destroyed) return true;
      respond(error.name === "RequestBodyTooLargeError" ? 413 : error.status || 400, {
        ok: false,
        error: error.message,
        code: error.code || "invalid_request",
      });
    }
    return true;
  };
