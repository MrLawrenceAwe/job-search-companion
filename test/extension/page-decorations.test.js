import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { runScriptsInDom } from "../../test-support/extension-scripts.js";
import { waitUntil } from "../../test-support/async.js";
import { blockerContract } from "../../shared/contracts.js";

const firstJob = 'https://uk.indeed.com/viewjob?jk=fixture111';
const secondJob = 'https://uk.indeed.com/viewjob?jk=fixture222';
const analysis = { jobUrl: firstJob, threadId: '01a11fef-d2cd-7410-953a-37e6497346d8', analyzedAt: new Date().toISOString() };
const result = {
  jobId: 'fixture111', outcome: 'no_blockers_found', findings: [],
  descriptionHash: 'description', profileHash: 'profile', model: 'test',
  checkerVersion: blockerContract.version, checkedAt: new Date().toISOString(),
};

const fixture = async (t) => {
  const dom = new JSDOM('<body><li><a href="/viewjob?jk=fixture111">Job</a></li><h1 data-testid="vj-job-title">Job</h1></body>', {
    url: firstJob, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const saved = {
    'applied-job:indeed:fixture111': { jobUrl: firstJob, appliedAt: new Date().toISOString() },
    'analyzed-job:indeed:fixture111': analysis,
  };
  window.chrome = {
    storage: {
      local: {
        get: async (key) => key === null ? { ...saved } : { [key]: saved[key] },
        set: async (values) => Object.assign(saved, values),
        remove: async (key) => { delete saved[key]; },
      },
      onChanged: { addListener() {} },
    },
    runtime: { sendMessage: (_, callback) => callback?.({ ok: true }) },
  };
  await runScriptsInDom(window, ['contracts/job-urls.js', 'contracts/identifiers.js', 'contracts/job-analyses.js', 'contracts/blockers.js', 'contracts/messages.js', 'extension-context.js', 'job-url.js']);
  const companion = window.jobSearchCompanion;
  let selectedJob = firstJob;
  let scans = 0;
  companion.dom.getRenderedRect = () => ({ width: 100, height: 30 });
  companion.jobs.collectJobCarriers = () => {
    scans++;
    return [{ element: window.document.querySelector('a'), jobUrl: firstJob }];
  };
  companion.jobs.resolveSelectedJobUrl = () => selectedJob;
  companion.showToast = () => {};
  await runScriptsInDom(window, ['page-decorations.js', 'job-mark-store.js', 'job-marks.js', 'job-analyses.js', 'blockers/renderer.js']);
  const scheduleFindings = companion.blockers.createRenderer({
    recordStore: { get: () => result }, checks: new Map(),
    getCurrentResult: () => selectedJob === firstJob ? result : null,
    startCheck() {},
    getContext: () => ({
      selection: { jobId: selectedJob === firstJob ? 'fixture111' : 'fixture222', descriptionHash: 'description', signature: selectedJob },
      checkerState: { settings: { enabled: true }, connectionStatus: { planUsageEnabled: true } },
    }),
  });
  await waitUntil(() => window.document.querySelector('.jsc-blocker-panel'));
  return { window, companion, scheduleFindings, scans: () => scans, select: (url) => { selectedJob = url; } };
};

test('marks, analysis and findings share one scan and stable containers without observing their own rendering', async (t) => {
  const { window, scheduleFindings, scans } = await fixture(t);
  assert.equal(scans(), 1);
  const root = window.document.querySelector('.jsc-detail-controls');
  const actions = root.querySelector('.jsc-job-actions');
  const analysisButton = actions.querySelector('.jsc-analysis-detail');
  assert.equal(actions.querySelectorAll('.jsc-job-mark-action').length, 2);
  assert.ok(analysisButton);
  assert.ok(root.querySelector('.jsc-job-findings .jsc-blocker-panel'));
  scheduleFindings();
  await waitUntil(() => scans() === 2);
  assert.equal(window.document.querySelector('.jsc-detail-controls'), root);
  assert.equal(actions.querySelector('.jsc-analysis-detail'), analysisButton);
  await new Promise((resolve) => window.setTimeout(resolve, 220));
  assert.equal(scans(), 2, 'feature rendering must not schedule an endless observer loop');
});

test('selection changes retarget controls and heading replacement moves all features together', async (t) => {
  const { window, companion, select } = await fixture(t);
  const firstControls = window.document.querySelector('.jsc-detail-controls');
  select(secondJob);
  companion.pageDecorations.schedule();
  await waitUntil(() => !window.document.querySelector('.jsc-analysis-detail'));
  assert.equal(window.document.querySelector('.jsc-applied-action').dataset.jobUrl, secondJob);
  const heading = window.document.createElement('h1');
  heading.dataset.testid = 'vj-job-title';
  heading.textContent = 'Replacement job';
  window.document.querySelector('h1').replaceWith(heading);
  await waitUntil(() => !firstControls.isConnected);
  assert.equal(window.document.querySelectorAll('.jsc-detail-controls').length, 1);
  assert.equal(heading.nextElementSibling.className, 'jsc-detail-controls');
  assert.equal(window.document.querySelectorAll('.jsc-blocker-panel').length, 1);
  heading.remove();
  await waitUntil(() => !window.document.querySelector('.jsc-detail-controls'));
});
