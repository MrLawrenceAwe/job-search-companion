import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { runScriptsInDom } from '../../test-support/extension-scripts.js';

const analysis = (verdict) => ({ threadId: '01a11fef-d2cd-7410-953a-37e6497346d8', analyzedAt: '2026-10-19T09:00:00Z', verdict });
const fixture = async (t, platform = 'indeed', stored = {}, resolveTitle = null, { includeAnalysisActions = false } = {}) => {
  const dom = new JSDOM('<body><h1>Support Advisor</h1></body>', { url: 'https://uk.indeed.com/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const saved = {
    'analyzed-job:indeed:fixture111': analysis('use as-is'),
    'analyzed-job:indeed:fixture222': analysis('edit the CV'),
    'analyzed-job:indeed:fixture333': analysis('use as-is'),
    'applied-job:indeed:fixture333': { appliedAt: '2026-10-19' },
    'analyzed-job:indeed:fixture444': analysis('do not apply yet'),
    'analyzed-job:indeed:fixture555': analysis('tailor into a role-specific CV'),
    'analyzed-job:indeed:fixture666': { ...analysis('use as-is'), threadId: 'bad' },
    'analyzed-job:linkedin:123456789': analysis('use as-is'),
    ...stored,
  };
  const changes = [];
  const renderers = [];
  const readiness = [];
  const render = (page) => { for (const renderer of renderers) renderer(page); };
  const page = { cards: new Map(), jobUrl: 'https://uk.indeed.com/viewjob?jk=fixture111', heading: window.document.querySelector('h1') };
  if (includeAnalysisActions) {
    const card = window.document.createElement('article');
    card.innerHTML = '<h2>Support Advisor</h2>';
    window.document.body.append(card);
    page.cards.set(card, page.jobUrl);
  }
  window.chrome = { runtime: { sendMessage: (message, callback) => {
    if (message.type === 'GET_INDEED_JOB_TITLE' && resolveTitle) resolveTitle(message, callback);
    else callback({ ok: message.type !== 'GET_INDEED_JOB_TITLE' });
  } }, storage: {
    local: { get: async () => saved, set: async (values) => Object.assign(saved, values), remove: async (key) => { delete saved[key]; } },
    onChanged: { addListener: (fn) => { changes.push(fn); } },
  } };
  await runScriptsInDom(window, ['contracts/job-urls.js', 'contracts/job-storage-keys.js', 'contracts/job-marks.js', 'contracts/indeed-availability.js', 'contracts/identifiers.js', 'contracts/job-analyses.js', 'contracts/messages.js']);
  window.jobSearchCompanion = { platform, pageDecorations: {
    register: (fn, promise) => { renderers.push(fn); readiness.push(promise); },
    schedule: () => render(page),
  } };
  await runScriptsInDom(window, ['job-analysis-store.js', ...(includeAnalysisActions ? ['job-analyses.js'] : []), 'indeed-to-apply-renderer.js', 'indeed-to-apply.js']);
  await Promise.all(readiness);
  render(page);
  return { window, saved, page, render, change: async (values) => { for (const listener of changes) listener(values, 'local'); await Promise.resolve(); } };
};

test('Indeed counter includes only unapplied positive verdicts, with safe job links and remembered titles', async (t) => {
  const { window, saved, render, page } = await fixture(t);
  const panel = window.document.querySelector('details');
  assert.equal(panel.open, false);
  assert.equal(panel.querySelector('summary').textContent, 'To apply · 2');
  const links = [...panel.querySelectorAll('li > a:first-child')];
  assert.equal(links[0].textContent, 'Support Advisor');
  assert.equal(links[0].href, page.jobUrl);
  assert.equal(links[1].href, 'https://uk.indeed.com/viewjob?jk=fixture222');
  assert.deepEqual([...panel.querySelectorAll('li > span')].map((node) => node.textContent), ['Use as is', 'Edit CV']);
  assert.equal(saved['job-title:indeed:fixture111'], 'Support Advisor');
  panel.open = true;
  render(page);
  assert.equal(panel.open, true);
  assert.equal(panel.querySelector('a'), links[0]);
});

test('verdict labels remain accurate outside the current To apply subset', async (t) => {
  const { window } = await fixture(t);
  const render = window.jobSearchCompanion.indeedToApply.createRenderer();
  render({ jobs: [{ url: 'https://uk.indeed.com/viewjob?jk=fixture111', title: 'Support Advisor',
    verdict: 'not enough information' }], syncState: 'ready' });
  const panels = [...window.document.querySelectorAll('.jsc-to-apply')];
  assert.equal(panels.at(-1).querySelector('li > span').textContent, 'Not enough information');
});

test('storage updates remove applied jobs, restore unmarked jobs, and refresh changed/deleted verdicts', async (t) => {
  const { window, change } = await fixture(t);
  const summary = () => window.document.querySelector('summary').textContent;
  await change({ 'applied-job:indeed:fixture111': { newValue: { appliedAt: '2026-10-19' } } });
  assert.equal(summary(), 'To apply · 1');
  await change({ 'applied-job:indeed:fixture111': { newValue: undefined } });
  assert.equal(summary(), 'To apply · 2');
  await change({ 'analyzed-job:indeed:fixture111': { newValue: analysis('no suitable base CV') }, 'analyzed-job:indeed:fixture222': { newValue: undefined } });
  assert.equal(summary(), 'To apply · 0');
  assert.equal(window.document.querySelector('details p').textContent, "No eligible unapplied jobs with a Use as is or Edit CV verdict.");
});

test('counter is absent on LinkedIn', async (t) => {
  const { window } = await fixture(t, 'linkedin');
  assert.equal(window.document.querySelector('details'), null);
});

test('Indeed applications remain excluded after a manual mark is removed', async (t) => {
  const { window, change, saved } = await fixture(t);
  await change({ 'indeed-applied-job:fixture111': { newValue: { detectedAt: '2026-10-19T12:00:00Z' } } });
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 1');
  await change({ 'applied-job:indeed:fixture111': { newValue: undefined } });
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 1');
  saved['indeed-applied-job:fixture222'] = { detectedAt: '2026-10-19T12:00:00Z' };
  await change({ 'indeed-applied-job:fixture222': { newValue: saved['indeed-applied-job:fixture222'] } });
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 0');
});

test('saved Indeed application detections are restored when a page loads', async (t) => {
  const { window } = await fixture(t, 'indeed', {
    'indeed-applied-job:fixture111': { detectedAt: '2026-10-19T12:00:00Z' },
  });
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 1');
  assert.equal(window.document.querySelector('details a').href, 'https://uk.indeed.com/viewjob?jk=fixture222');
});

test('Indeed refresh failure explains that the counter is using saved status', async (t) => {
  const { window } = await fixture(t);
  window.chrome.runtime.sendMessage = (_message, callback) => callback({ ok: false });
  window.dispatchEvent(new window.Event('pageshow'));
  assert.match(window.document.querySelector('[role="status"]').textContent, /Showing saved status/);
});

test('missing titles load automatically and update the expanded list without showing IDs', async (t) => {
  let completeTitle;
  const { window } = await fixture(t, 'indeed', {}, (message, callback) => {
    assert.equal(message.jobId, 'fixture222');
    completeTitle = callback;
  });
  const panel = window.document.querySelector('details');
  panel.open = true;
  assert.equal(panel.querySelectorAll('li > a:first-child')[1].textContent, 'Loading job title…');
  completeTitle({ ok: true, title: 'Delivery Station Warehouse Associate' });
  assert.equal(panel.querySelectorAll('li > a:first-child')[1].textContent, 'Delivery Station Warehouse Associate');
  assert.equal(panel.querySelectorAll('li > a:first-child')[1].href, 'https://uk.indeed.com/viewjob?jk=fixture222');
  assert.equal(panel.open, true);
  assert.equal(panel.querySelector('summary').textContent, 'To apply · 2');
});

test('an unavailable title keeps its job link without displaying an Indeed ID', async (t) => {
  const { window } = await fixture(t);
  const link = window.document.querySelectorAll('details li > a:first-child')[1];
  assert.equal(link.textContent, 'Job title unavailable — open listing');
  assert.equal(link.href, 'https://uk.indeed.com/viewjob?jk=fixture222');
});

test('unsuitable jobs are excluded on load and react to marks and unmarks across tabs', async (t) => {
  const { window, change } = await fixture(t, 'indeed', {
    'unsuitable-job:indeed:fixture111': { unsuitableAt: '2026-10-19' },
  });
  const summary = () => window.document.querySelector('summary').textContent;
  assert.equal(summary(), 'To apply · 1');
  await change({ 'unsuitable-job:indeed:fixture111': { newValue: undefined } });
  assert.equal(summary(), 'To apply · 2');
  await change({ 'unsuitable-job:indeed:fixture222': { newValue: { unsuitableAt: '2026-10-19' } } });
  assert.equal(summary(), 'To apply · 1');
});

test('native Indeed thumbs-down removes the selected job and undo preserves a manual unsuitable mark', async (t) => {
  const { window, saved, change } = await fixture(t);
  const button = window.document.createElement('button');
  button.dataset.testid = 'vj-dislikeJobButton';
  button.setAttribute('aria-label', 'Not Interested, Support Advisor');
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = '<svg></svg>';
  window.document.body.append(button);
  button.querySelector('svg').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(setImmediate);
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 1');
  assert.ok(saved['indeed-dismissed-job:fixture111'].dismissedAt);
  await change({ 'unsuitable-job:indeed:fixture111': { newValue: { unsuitableAt: '2026-10-19' } } });
  button.setAttribute('aria-pressed', 'true');
  button.click();
  await new Promise(setImmediate);
  assert.equal(saved['indeed-dismissed-job:fixture111'], undefined);
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 1');
  await change({ 'unsuitable-job:indeed:fixture111': { newValue: undefined } });
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 2');
});

test('native dismissal on a search card targets that card, not the selected job, and survives reload', async (t) => {
  const { window, saved, render, page } = await fixture(t);
  const card = window.document.createElement('article');
  card.innerHTML = '<button aria-label="Not interested">Dismiss</button>';
  window.document.body.append(card);
  page.cards.set(card, 'https://uk.indeed.com/viewjob?jk=fixture222');
  render(page);
  card.querySelector('button').click();
  await new Promise(setImmediate);
  assert.ok(saved['indeed-dismissed-job:fixture222']);
  assert.equal(saved['indeed-dismissed-job:fixture111'], undefined);
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 1');
  const restored = await fixture(t, 'indeed', saved);
  assert.equal(restored.window.document.querySelector('summary').textContent, 'To apply · 1');
  assert.equal(restored.window.document.querySelector('details a').href, page.jobUrl);
});

test('the open expired job is removed immediately and the detection survives reloads', async (t) => {
  const { window, saved, render, page } = await fixture(t);
  const notice = window.document.createElement('div');
  notice.id = 'alert-content';
  notice.innerHTML = '<h3>This job has expired on Indeed</h3><div>Reasons could include: the employer is not accepting applications</div>';
  window.document.body.append(notice);
  render(page);
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 1');
  assert.equal(saved['indeed-job-availability:fixture111'].status, 'expired');
  const restored = await fixture(t, 'indeed', saved);
  assert.equal(restored.window.document.querySelector('summary').textContent, 'To apply · 1');
  assert.equal(restored.window.document.querySelector('details a').href, 'https://uk.indeed.com/viewjob?jk=fixture222');
});

test('availability changes update the list across tabs and allow confirmed reopened jobs back in', async (t) => {
  const { window, change } = await fixture(t);
  await change({ 'indeed-job-availability:fixture222': { newValue: { status: 'expired', checkedAt: new Date().toISOString() } } });
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 1');
  await change({ 'indeed-job-availability:fixture222': { newValue: { status: 'active', checkedAt: new Date().toISOString() } } });
  assert.equal(window.document.querySelector('summary').textContent, 'To apply · 2');
});

test('one analysis storage change updates both the badge and To apply list', async (t) => {
  const { window, change } = await fixture(t, 'indeed', {}, null, { includeAnalysisActions: true });
  const badge = () => window.document.querySelector('.jsc-analyzed-badge');
  const summary = () => window.document.querySelector('.jsc-to-apply > summary').textContent;
  assert.equal(badge().dataset.verdictColor, 'green');
  assert.equal(summary(), 'To apply · 2');
  await change({ 'analyzed-job:indeed:fixture111': { newValue: analysis('no suitable base CV') } });
  assert.equal(badge().dataset.verdictColor, 'red');
  assert.equal(summary(), 'To apply · 1');
  await change({ 'analyzed-job:indeed:fixture111': { newValue: undefined } });
  assert.equal(badge(), null);
  assert.equal(summary(), 'To apply · 1');
});
