import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { createBlockerRoutes } from "../../../bridge/blockers/routes.js";
import { createRequestHandler } from "../../../bridge/request-handler.js";
import { openSubmissionStore } from "../../../bridge/submission-store.js";

test("checker routes require the existing bridge authentication boundary", async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-routes-"));
  const handler = createRequestHandler({ bridgeConfig: { token: "token", allowedExtensionOrigin: "chrome-extension://test" }, submissionStore: await openSubmissionStore(join(await realpath(directory), "submissions.json")), blockerRoutes: createBlockerRoutes({ checker: { status: async () => ({ settings: { enabled: false } }) } }) });
  const server = createServer((req, res) => void handler(req, res)); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/blockers/status`;
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { headers: { "X-JSC-Token": "token", Origin: "https://uk.indeed.com" } })).status, 403);
    const response = await fetch(url, { headers: { "X-JSC-Token": "token", Origin: "chrome-extension://test" } });
    assert.equal(response.status, 200); assert.equal((await response.json()).settings.enabled, false);
  } finally { server.close(); }
});
