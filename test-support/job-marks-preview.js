// Only the test page uses localStorage. Production uses chrome.storage.local.
const changeListeners = [];
const readRecords = () => JSON.parse(localStorage.getItem('companion-preview') || '{}');
const writeRecords = (records) => localStorage.setItem('companion-preview', JSON.stringify(records));
window.chrome = { storage: {
  local: {
    async get(key) { const records = readRecords(); return key === null ? records : { [key]: records[key] }; },
    async set(values) {
      const records = readRecords(); const changes = {};
      for (const [key, value] of Object.entries(values)) { changes[key] = {oldValue: records[key], newValue: value}; records[key] = value; }
      writeRecords(records); changeListeners.forEach(listener => listener(changes, 'local'));
    },
    async remove(key) { const records = readRecords(); const oldValue = records[key]; delete records[key]; writeRecords(records); changeListeners.forEach(listener => listener({[key]: {oldValue}}, 'local')); }
  }, onChanged: { addListener(listener) { changeListeners.push(listener); } }
}, runtime: { sendMessage(_message, callback) { callback({ok:false, error:'CV analysis is disabled in the preview'}); } } };
window.addEventListener('storage', event => {
  if (event.key !== 'companion-preview') return;
  const before = JSON.parse(event.oldValue || '{}'); const after = JSON.parse(event.newValue || '{}'); const changes = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) changes[key] = {oldValue:before[key], newValue:after[key]};
  changeListeners.forEach(listener => listener(changes, 'local'));
});
document.addEventListener('click', event => {
  const selected = event.target.closest('[data-select]');
  if (selected) {
    document.querySelector('link[rel="canonical"]').href = 'https://uk.indeed.com/viewjob?jk=' + selected.dataset.select;
    document.querySelector('[data-testid="vj-job-title"]').textContent = selected.dataset.select === 'demojob111' ? 'Accounts Apprentice' : 'Office Administrator';
    document.querySelector('#company').textContent = selected.dataset.select === 'demojob111' ? 'Example Accountancy · Welwyn Garden City' : 'Example Services · London';
    document.querySelector('#demo-menu').hidden = true;
  }
});
document.querySelector('#replace-cards').onclick = () => {
  const cards = document.querySelector('#cards'); cards.replaceWith(cards.cloneNode(true));
};
document.querySelector('#open-menu').onclick = () => { document.querySelector('#demo-menu').hidden = false; };

await import("../extension/contracts/job-urls.js");
await import("../extension/contracts/blockers.js");
await import("../extension/contracts/messages.js");
await import("../extension/contracts/shortcuts.js");
await import("../extension/extension-context.js");
await import("../extension/dom-visibility.js");
await import("../extension/job-url.js");
await import("../extension/job-resolution.js");
await import("../extension/job-navigation.js");
await import("../extension/feedback.js");
await import("../extension/contracts/cv-fit-submissions.js");
await import("../extension/cv-fit-submission.js");
await import("../extension/job-mark-store.js");
await import("../extension/page-decorations.js");
await import("../extension/job-marks.js");
await import("../extension/job-menu.js");
await import("../extension/job-menu-observer.js");
