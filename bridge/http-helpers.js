const MAX_JSON_BODY_CHARS = 20_000;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "RequestBodyTooLargeError";
  }
}

export const isRequestOriginAllowed = (req, allowedOrigin) => {
  const origin = req.headers.origin;
  return !origin || origin === allowedOrigin;
};

export const isRequestTokenValid = (req, token) => {
  return req.headers["x-cv-fit-bridge-token"] === token;
};

const createCorsHeaders = (req, allowedOrigin) => {
  const origin = req.headers.origin;
  if (!origin) {
    return {};
  }

  if (!isRequestOriginAllowed(req, allowedOrigin)) {
    return { Vary: "Origin" };
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-CV-Fit-Bridge-Token",
    Vary: "Origin",
  };
};

export const sendJson = (
  req,
  res,
  statusCode,
  payload,
  { allowedOrigin },
) => {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...createCorsHeaders(req, allowedOrigin),
  });
  res.end(JSON.stringify(payload));
};

export const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    let rejected = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (rejected) {
        return;
      }

      body += chunk;
      if (body.length > MAX_JSON_BODY_CHARS) {
        rejected = true;
        body = "";
        reject(new RequestBodyTooLargeError());
      }
    });
    req.on("end", () => {
      if (rejected) {
        return;
      }

      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be JSON"));
      }
    });
    req.on("error", reject);
  });
