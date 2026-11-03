import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once, EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { blockerContract } from "../../../shared/contracts.js";
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


test("check routes reject malformed UUIDs before calling the checker", async () => {
  const { EventEmitter } = await import("node:events");
  const routes = createBlockerRoutes({ checker: {
    wait() { assert.fail("Malformed IDs must not reach the checker"); },
  } });
  const replies = [];
  assert.equal(await routes(
    { method: "GET", url: `/blockers/checks/${"-".repeat(36)}` },
    (status, body) => replies.push({ status, body }),
    new EventEmitter(),
  ), true);
  assert.equal(replies[0].status, 400);
  assert.equal(replies[0].body.error, "Invalid check ID");
});


test("check transport accepts maximum escaped fields and rejects oversized envelopes", async () => {
  const { limits, maximumRequestBodyCharacters } = blockerContract;
  const input = {
    jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111",
    description: "\u0001".repeat(limits.maximumDescriptionCharacters),
    challenge: {
      requirementQuote: "\u0001".repeat(limits.maximumQuoteCharacters),
      reason: "\u0001".repeat(limits.maximumChallengeCharacters),
    },
  };
  let received;
  const routes = createBlockerRoutes({ checker: { start: async (body) => { received = body; return { status: "queued" }; } } });
  const request = async (body) => {
    const req = new PassThrough();
    req.method = "POST";
    req.url = "/blockers/checks";
    const replies = [];
    const pending = routes(req, (status, payload) => replies.push({ status, payload }), new EventEmitter());
    req.end(body);
    await pending;
    return replies[0];
  };
  const encoded = JSON.stringify(input);
  assert.ok(encoded.length > 100_000);
  assert.ok(encoded.length <= maximumRequestBodyCharacters);
  assert.equal((await request(encoded)).status, 200);
  assert.deepEqual(received, input);
  assert.equal((await request(" ".repeat(maximumRequestBodyCharacters + 1))).status, 413);
});
