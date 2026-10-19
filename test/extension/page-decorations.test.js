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
  descriptionHash: 'description', evidenceHash: 'profile', model: 'test',
  checkerVersion: blockerContract.version, checkedAt: new Date().toISOString(),
};

const fixture = async (t, { applyMarkup = "", cardMarkup = "" } = {}) => {
  const dom = new JSDOM(`<body><li><a href="/viewjob?jk=fixture111">Job</a>${cardMarkup}</li><div data-testid="viewjob-main-content"><h1 data-testid="vj-job-title">Job</h1><section id="apply-controls">${applyMarkup}</section></div></body>`, {
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
  await runScriptsInDom(window, ['contracts/job-urls.js', 'contracts/job-storage-keys.js', 'contracts/job-marks.js', 'contracts/identifiers.js', 'contracts/job-analyses.js', 'contracts/blockers.js', 'contracts/messages.js', 'extension-context.js', 'job-url.js']);
  const companion = window.jobSearchCompanion;
  let selectedJob = firstJob;
  let scans = 0;
  companion.dom.getRenderedRect = (element) => element.hidden ? null : ({ width: 100, height: 30 });
  companion.dom.getViewportRect = companion.dom.getRenderedRect;
  companion.dom.queryIncludingRoot = (root, selector) => [ ...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector) ];
  companion.jobs.collectJobCarriers = () => {
    scans++;
    return [{ element: window.document.querySelector('a'), jobUrl: firstJob }];
  };
  companion.jobs.resolveSelectedJobUrl = () => selectedJob;
  companion.showToast = () => {};
  await runScriptsInDom(window, ['page-decorations.js', 'job-mark-store.js', 'job-marks.js', 'job-analysis-store.js', 'job-analyses.js', 'blockers/renderer.js']);
  const scheduleFindings = companion.pageDecorations.schedule;
  companion.blockers.registerRenderer({
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

test('page-change subscribers share DOM and navigation events and ignore extension rendering', async (t) => {
  const { window, companion, scheduleFindings } = await fixture(t);
  let changes = 0;
  const unsubscribe = companion.pageDecorations.subscribe(() => changes++);
  scheduleFindings();
  await new Promise((resolve) => window.setTimeout(resolve, 220));
  assert.equal(changes, 0, 'rendering must not trigger a checker scan');
  window.document.querySelector('a').firstChild.nodeValue = 'Updated job';
  await waitUntil(() => changes === 1);
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  window.document.querySelector('a').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(changes, 3);
  unsubscribe();
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  assert.equal(changes, 3);
});

const openJobMenu = async (window, companion, jobUrl = firstJob) => {
  await runScriptsInDom(window, ['contracts/shortcuts.js', 'job-menu.js']);
  companion.jobs.consumeMenuJobUrl = () => jobUrl;
  const menu = window.document.createElement('div');
  const row = window.document.createElement('button');
  row.textContent = 'WhatsApp';
  menu.append('Copy link Email ', row);
  window.document.body.append(menu);
  assert.equal(companion.jobMenu.insertJobMenuActions(menu), true);
  return menu;
};

for (const [label, applyMarkup, cardMarkup] of [
  ['Indeed Apply control', '<a data-testid="viewjob-indeed-apply" href="/apply">Apply now</a>', ''],
  ['Smart Apply link', '<a href="https://smartapply.indeed.com/beta/indeedapply/applybyapplyablejobid?indeedApplyableJobId=fixture">Apply now</a>', ''],
  ['classic Indeed Apply button', '<button id="indeedApplyButton">Apply now</button>', ''],
  ['Easily apply card badge', '', '<span>Easily apply</span>'],
]) {
  test(`Indeed ${label}: omits applied controls and menu option while retaining other actions and saved badges`, async (t) => {
    const { window, companion } = await fixture(t, { applyMarkup, cardMarkup });
    assert.equal(window.document.querySelector('.jsc-applied-action'), null);
    assert.ok(window.document.querySelector('.jsc-unsuitable-action'));
    assert.ok(window.document.querySelector('.jsc-applied-badge'), 'saved record remains visible');
    const menu = await openJobMenu(window, companion);
    assert.equal(menu.querySelector('.jsc-applied-action'), null);
    assert.ok(menu.querySelector('.jsc-unsuitable-action'));
    assert.equal(menu.querySelectorAll('.jsc-menu-item').length, 2);
  });
}

for (const [label, applyMarkup] of [
  ['employer website', '<a href="https://careers.example.org/apply">Apply on company site</a>'],
  ['email', '<a href="mailto:recruitment@example.org">Apply by email</a>'],
  ['Indeed external redirect', '<a href="https://uk.indeed.com/rc/clk?jk=fixture111">Apply now</a>'],
]) {
  test(`Indeed ${label}: keeps applied controls and menu option`, async (t) => {
    const { window, companion } = await fixture(t, { applyMarkup });
    assert.ok(window.document.querySelector('.jsc-applied-action'));
    const menu = await openJobMenu(window, companion);
    assert.ok(menu.querySelector('.jsc-applied-action'));
    assert.ok(menu.querySelector('.jsc-unsuitable-action'));
  });
}

test('Indeed route changes update controls and an already open menu, then restore manual marking for an external job', async (t) => {
  const { window, companion, select } = await fixture(t);
  const menu = await openJobMenu(window, companion);
  const controls = window.document.querySelector('#apply-controls');
  controls.innerHTML = '<a data-testid="viewjob-indeed-apply" href="https://smartapply.indeed.com/apply">Apply now</a>';
  await waitUntil(() => !window.document.querySelector('.jsc-applied-action'));
  assert.equal(menu.querySelector('.jsc-applied-action'), null);
  select(secondJob);
  controls.innerHTML = '<a href="mailto:recruitment@example.org">Apply by email</a>';
  await waitUntil(() => window.document.querySelector('.jsc-applied-action')?.dataset.jobUrl === secondJob);
});

test('Indeed detection uses the menu job, not a different selected pane or card', async (t) => {
  const { window, companion, select } = await fixture(t, {
    applyMarkup: '<a data-testid="viewjob-indeed-apply" href="https://smartapply.indeed.com/apply">Apply now</a>',
  });
  // The selected pane is native Apply; a menu for a different job keeps manual tracking.
  const menu = await openJobMenu(window, companion, secondJob);
  assert.ok(menu.querySelector('.jsc-applied-action'));
  // A badge on the first card must not affect a second, externally applied job.
  menu.remove();
  window.document.querySelector('li').insertAdjacentHTML('beforeend', '<span>Easily apply</span>');
  select(secondJob);
  window.document.querySelector('#apply-controls').innerHTML = '<a href="https://example.org/apply">Apply now</a>';
  companion.pageDecorations.schedule();
  await waitUntil(() => window.document.querySelector('.jsc-applied-action')?.dataset.jobUrl === secondJob);
});

test('LinkedIn manual applied action remains available regardless of Indeed-like labels', async (t) => {
  const { window, companion } = await fixture(t, { cardMarkup: '<span>Easily apply</span>' });
  companion.platform = 'linkedin';
  companion.pageDecorations.schedule();
  await waitUntil(() => window.document.querySelector('.jsc-applied-action'));
});

test('Indeed puts CV fit first and keeps actions when the last native row is below the viewport', async (t) => {
  const { window, companion } = await fixture(t);
  await runScriptsInDom(window, ['contracts/shortcuts.js', 'job-menu.js']);
  companion.jobs.consumeMenuJobUrl = () => firstJob;
  const menu = window.document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = '<div role="menuitem">Copy link</div><div role="menuitem">Email</div><div role="menuitem">Text message</div><div role="menuitem">WhatsApp</div>';
  window.document.body.append(menu);
  menu.getBoundingClientRect = () => ({ top: 700, left: 200, width: 300, height: 320 });
  companion.dom.getViewportRect = (element) => element.textContent === 'WhatsApp' || element.matches('.jsc-menu-item')
    ? null : companion.dom.getRenderedRect(element);
  assert.equal(companion.jobMenu.insertJobMenuActions(menu), true);
  assert.match(menu.firstElementChild.textContent, /Analyse with CV Fit Advisor/);
  assert.ok(menu.classList.contains('jsc-share-menu'));
  assert.equal(menu.style.top, `${window.innerHeight - 320 - 8}px`);
  assert.equal(companion.jobMenu.insertJobMenuActions(menu), true);
  assert.equal(menu.querySelectorAll('.jsc-menu-item').length, 3);
});
