import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer } from "node:http";
import { createBlockerRoutes } from "../../../bridge/blockers/routes.js";
import { createRequestHandler } from "../../../bridge/request-handler.js";
import { openCvFitSubmissionStore } from "../../../bridge/cv-fit-submission-store.js";

test("checker routes require the existing bridge authentication boundary", async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "jsc-routes-"));
  const handler = createRequestHandler({ bridgeConfig: { token: "token", allowedExtensionOrigin: "chrome-extension://test" }, submissionStore: await openCvFitSubmissionStore(join(await realpath(directory), "submissions.json")), blockerRoutes: createBlockerRoutes({ checker: { status: async () => ({ settings: { enabled: false } }) } }) });
  const server = createServer((req, res) => void handler(req, res)); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/blockers/status`;
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { headers: { "X-JSC-Token": "token", Origin: "https://uk.indeed.com" } })).status, 403);
    const response = await fetch(url, { headers: { "X-JSC-Token": "token", Origin: "chrome-extension://test" } });
    assert.equal(response.status, 200); assert.equal((await response.json()).settings.enabled, false);
  } finally { server.close(); }
});

test("check route waits for a result and releases its wait when the client disconnects", async () => {
  const { EventEmitter } = await import("node:events");
  const id = "11111111-1111-1111-1111-111111111111";
  let release;
  let waitSignal;
  const routes = createBlockerRoutes({ checker: {
    wait: async (requestedId, { signal }) => {
      assert.equal(requestedId, id);
      waitSignal = signal;
      return new Promise((resolve, reject) => {
        release = () => resolve({ id, status: "completed" });
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  } });
  const req = { method: "GET", url: `/blockers/checks/${id}` };
  const res = new EventEmitter();
  const replies = [];
  const pending = routes(req, (status, body) => replies.push({ status, body }), res);
  assert.equal(replies.length, 0);
  release();
  assert.equal(await pending, true);
  assert.equal(replies[0].body.check.status, "completed");
  assert.equal(res.listenerCount("close"), 0);
  const disconnected = routes(req, () => {}, res);
  res.emit("close");
  await disconnected;
  assert.equal(waitSignal.aborted, true);
  assert.equal(res.listenerCount("close"), 0);
});
