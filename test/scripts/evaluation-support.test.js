import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createEvaluationClient, writeEvaluationReport, evaluationVersions } from "../../scripts/evaluations/support.js";

const fixture = async (t) => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'jsc-evaluation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test('evaluation reads the active fresh credential without refreshing or changing the account store', async (t) => {
  const accountPath = join(await fixture(t), 'accounts.json');
  const state = JSON.stringify({ activeId: 'active', accounts: [{ id: 'other', accessToken: 'other' }, { id: 'active', accessToken: 'fixture-token', expiresAt: Date.now() + 120_000 }] });
  await writeFile(accountPath, state);
  let calls = 0;
  const client = createEvaluationClient({ accountPath, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    return Response.json({ ok: true });
  } });
  await client.request('responses');
  assert.equal(await readFile(accountPath, 'utf8'), state);
  await writeFile(accountPath, JSON.stringify({ activeId: 'active', accounts: [{ id: 'active', accessToken: 'expired', expiresAt: Date.now() }] }));
  await assert.rejects(client.request('responses'), /Refresh the connected account/);
  assert.equal(calls, 1);
});

test('dated evaluation reports carry contract and prompt metadata and cannot overwrite an earlier run', async (t) => {
  const directory = pathToFileURL((await fixture(t)) + '/');
  const report = { measuredAt: '2026-10-09T12:00:00.000Z', runs: [] };
  const path = await writeEvaluationReport('fixture', report, directory);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(saved, { ...report, ...evaluationVersions });
  assert.match(path.pathname, /2026-10-09T12-00-00-000Z-fixture.json$/);
  await assert.rejects(writeEvaluationReport('fixture', { ...report, runs: ['new'] }, directory), { code: 'EEXIST' });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), saved);
});
