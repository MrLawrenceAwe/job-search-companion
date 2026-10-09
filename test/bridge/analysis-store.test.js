import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, realpath, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAnalysisStore } from "../../bridge/analysis-store.js";

const id = "12345678-1234-1234-1234-123456789abc";
const threadId = "01a11fef-d2cd-7410-953a-37e6497346d8";
const verdict = "use as-is";
const jobUrl = "https://uk.indeed.com/viewjob?jk=fixture111";
const fixture = async (t) => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), "job-analyses-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "analyses.json");
  return { path, store: await openAnalysisStore(path) };
};

test("only a scoped completion marks a job; completed links survive restart", async (t) => {
  const { path, store } = await fixture(t);
  const completion = await store.create({ id, jobUrl });
  assert.deepEqual(store.list(), []);
  await assert.rejects(store.complete({ id, token: "wrong", threadId, verdict }), /token/);
  await assert.rejects(store.complete({ id, token: completion.token, verdict, threadId: "codex://settings" }), /chat ID/);
  await assert.rejects(store.complete({ id: threadId, token: completion.token, threadId, verdict }), /token/);
  await assert.rejects(store.complete({ ...completion, threadId, verdict: "apply" }), /verdict/);
  assert.deepEqual(store.list(), []);
  const record = await store.complete({ ...completion, threadId, verdict });
  assert.equal(record.threadId, threadId);
  assert.equal(record.jobUrl, jobUrl);
  assert.ok(Number.isFinite(Date.parse(record.analyzedAt)));
  assert.deepEqual(await store.complete({ ...completion, threadId, verdict }), record);
  await assert.rejects(store.complete({ ...completion, verdict, threadId: id }), /another chat/);
  assert.deepEqual((await openAnalysisStore(path)).list(), [record]);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await readFile(path, "utf8")).includes(completion.token), false);
  assert.equal("tokenHash" in record, false);
});

test("concurrent jobs are independent and reanalysis keeps the last completed result", async (t) => {
  const { path, store } = await fixture(t);
  const secondId = "22345678-1234-1234-1234-123456789abc";
  const linkedinId = "32345678-1234-1234-1234-123456789abc";
  const [first, second] = await Promise.all([
    store.create({ id, jobUrl }),
    store.create({ id: linkedinId, jobUrl: "https://www.linkedin.com/jobs/view/4447780789/" }),
  ]);
  await Promise.all([store.complete({ ...first, threadId, verdict }), store.complete({ ...second, verdict, threadId: id })]);
  assert.equal((await openAnalysisStore(path)).list().length, 2);
  await store.create({ id: secondId, jobUrl: "https://www.indeed.com/viewjob?jk=fixture111" });
  assert.equal(store.list().length, 2);
  assert.equal(store.list().find((r) => r.jobUrl === jobUrl).threadId, threadId);
});
