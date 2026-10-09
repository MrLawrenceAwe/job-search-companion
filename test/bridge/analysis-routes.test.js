import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openAnalysisStore } from "../../bridge/analysis-store.js";
import { createRequestHandler } from "../../bridge/request-handler.js";

const id = "12345678-1234-1234-1234-123456789abc";
const threadId = "01a11fef-d2cd-7410-953a-37e6497346d8";

test("scoped callbacks work without the bridge credential; list/open retain general authentication", async (t) => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), "analysis-routes-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await openAnalysisStore(join(dir, "analyses.json"));
  const completion = await store.create({ id, jobUrl: "https://uk.indeed.com/viewjob?jk=fixture111" });
  const handler = createRequestHandler({
    bridgeConfig: { token: "bridge-token", allowedExtensionOrigin: "chrome-extension://test" },
    submissionStore: { submissions: new Map() }, analysisStore: store,
  });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (headers, requestId = id) => fetch(`${base}/analyses/${requestId}/complete`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ threadId, verdict: "edit the CV" }),
  });
  assert.equal((await post({ "x-jsc-analysis-token": "bad" })).status, 400);
  assert.equal((await post({ "x-jsc-token": "bridge-token" })).status, 400);
  assert.equal((await post({ origin: "https://attacker.test", "x-jsc-analysis-token": completion.token })).status, 403);
  assert.deepEqual(store.list(), []);
  assert.equal((await post({ "x-jsc-analysis-token": completion.token })).status, 200);
  assert.equal((await post({ "x-jsc-analysis-token": completion.token }, threadId)).status, 400);
  assert.equal((await fetch(`${base}/analyses`)).status, 403);
  assert.equal((await fetch(`${base}/analyses/open`, { method: "POST" })).status, 403);
  const records = await (await fetch(`${base}/analyses`, { headers: { "x-jsc-token": "bridge-token" } })).json();
  assert.equal(records.analyses[0].threadId, threadId);
  assert.equal(records.analyses[0].verdict, "edit the CV");
  assert.equal(JSON.stringify(records).includes(completion.token), false);
  assert.equal("tokenHash" in records.analyses[0], false);
});
