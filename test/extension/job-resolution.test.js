import assert from "node:assert/strict";
import test from "node:test";

import { createElement, createJobFixture } from "../../test-support/job-fixture.js";

const captureTitle = (companion, body, title) => {
  const heading = createElement({ text: title, isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;
  companion.jobs.captureMenuContext(createElement({ parent: card }));
};

const visibleJobCarrier = (jobKey, title) => ({
  children: [],
  parentElement: null,
  textContent: title,
  title: "",
  getAttribute: (name) => name === "href" ? `/viewjob?jk=${jobKey}` : null,
  matches: (selector) => selector.includes("[href]"),
});

test("Indeed home-page job identity stays stable when mark controls change title-row text", async () => {
  const { companion, document } = await createJobFixture({ href: "https://uk.indeed.com/" });
  const title = "IT Infrastructure Engineer – AI";
  const heading = createElement({ text: title });
  const titleRow = createElement({ text: title });
  const carrier = visibleJobCarrier("fixture123", title);
  document.querySelectorAll = (selector) => {
    if (selector === companion.selectors.jobUrlCarrier) return [carrier];
    // Indeed renders company-info-title-row before its vj-job-title child.
    if (selector.includes('[data-testid*="title" i]')) return [titleRow, heading];
    if (selector.includes('[data-testid="vj-job-title"]')) return [heading];
    return [];
  };
  companion.dom.getViewportRect = (element) => ({
    width: 500, height: 40, left: element === carrier ? 0 : 750, top: 100,
  });

  const expectedUrl = "https://uk.indeed.com/viewjob?jk=fixture123";
  assert.equal(companion.jobs.resolveSelectedJobUrl(), expectedUrl);
  for (const controls of ["Mark as appliedMark as unsuitable", "Unmark as appliedMark as unsuitable", ""]) {
    titleRow.textContent = title + controls;
    assert.equal(companion.jobs.resolveSelectedJobUrl(), expectedUrl);
  }

  // A real selection change must still update the controls' job identity.
  heading.textContent = "Support Specialist";
  carrier.textContent = heading.textContent;
  carrier.getAttribute = (name) => name === "href" ? "/viewjob?jk=secondjob1" : null;
  assert.equal(companion.jobs.resolveSelectedJobUrl(), "https://uk.indeed.com/viewjob?jk=secondjob1");
});

test("resolves an embedded job key using the captured menu context", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
    scripts: ['{"jobKey":"fixture123","title":"Senior Support Specialist"}'],
  });
  const heading = createElement({ text: "Senior Support Specialist", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;
  const menuButton = createElement({ parent: card });

  companion.jobs.captureMenuContext(menuButton);

  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=fixture123",
  );
});

test("ignores Indeed's detail-heading suffix when resolving the menu job", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/?vjk=03eef228667e3e0d",
    scripts: ['{"jobKey":"03eef228667e3e0d","displayTitle":"Project Administrator"}'],
  });
  const heading = createElement({ text: "Project Administrator - job post", isHeading: true });
  const detailHeader = createElement({ parent: body, heading });
  heading.parentElement = detailHeader;

  companion.jobs.captureMenuContext(createElement({ parent: detailHeader }));

  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=03eef228667e3e0d",
  );
});

test("falls back to the canonical job URL", async () => {
  const { companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
    canonicalUrl: "https://uk.indeed.com/viewjob?jk=canonical1&utm_source=test",
  });

  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=canonical1",
  );
});

test("does not treat arbitrary Indeed pages with a job-like query as job pages", async () => {
  const { companion } = await createJobFixture({
    href: "https://uk.indeed.com/company?jk=canonical1",
  });

  assert.equal(
    companion.jobs.jobUrlFromPageUrl("https://uk.indeed.com/company?jk=canonical1"),
    null,
  );
});

test("resolves a LinkedIn detail-page job URL", async () => {
  const { companion } = await createJobFixture({
    href: "https://www.linkedin.com/jobs/view/4447780789/?trackingId=ignored",
  });

  assert.equal(
    companion.jobs.resolvePageJobUrl(),
    "https://www.linkedin.com/jobs/view/4447780789/",
  );
});

test("resolves the selected LinkedIn job from currentJobId", async () => {
  const { companion } = await createJobFixture({
    href: "https://www.linkedin.com/jobs/search-results/?currentJobId=4447780789&keywords=qa",
  });

  assert.equal(
    companion.jobs.resolvePageJobUrl(),
    "https://www.linkedin.com/jobs/view/4447780789/",
  );
});

test("keeps the LinkedIn job selected when its More options menu opens", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://www.linkedin.com/jobs/search-results/?currentJobId=4447780789",
  });

  companion.jobs.captureMenuContext(createElement({ parent: body }));

  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://www.linkedin.com/jobs/view/4447780789/",
  );
});

test("prefers the exact job key in the results-page URL", async () => {
  const { companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=detailpane1",
    scripts: ['{"jobKey":"unrelated1","title":"Another Job"}'],
  });

  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=detailpane1",
  );
});

test("prefers captured menu context over a different results-page job", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=otherjob1",
    scripts: ['{"jobKey":"sharedjob1","title":"Shared Support Job"}'],
  });
  const heading = createElement({ text: "Shared Support Job", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;

  companion.jobs.captureMenuContext(createElement({ parent: card }));

  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=sharedjob1",
  );
});

test("resolves the page job independently of stale job-menu context", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=currentjob1",
    scripts: ['{"jobKey":"sharedjob1","title":"Previously Shared Job"}'],
  });
  const heading = createElement({ text: "Previously Shared Job", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;
  companion.jobs.captureMenuContext(createElement({ parent: card }));

  assert.equal(
    companion.jobs.resolvePageJobUrl(),
    "https://uk.indeed.com/viewjob?jk=currentjob1",
  );
  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=sharedjob1",
  );
});

test("uses title evidence to disambiguate multiple job URLs near the menu button", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=otherjob1",
    scripts: ['{"jobKey":"sharedjob1","title":"Shared Support Job"}'],
  });
  const heading = createElement({ text: "Shared Support Job", isHeading: true });
  const nearbyJobLinks = [
    {
      children: [],
      getAttribute: (name) => name === "href"
        ? "https://uk.indeed.com/viewjob?jk=sharedjob1"
        : null,
      matches: (selector) => selector.includes("[href]"),
    },
    {
      children: [],
      getAttribute: (name) => name === "href"
        ? "https://uk.indeed.com/viewjob?jk=nearbyjob2"
        : null,
      matches: (selector) => selector.includes("[href]"),
    },
  ];
  const card = createElement({ parent: body, heading });
  card.children.push(...nearbyJobLinks);
  heading.parentElement = card;

  companion.jobs.captureMenuContext(createElement({ parent: card }));

  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=sharedjob1",
  );
});

test("fails closed when a single nearby URL conflicts with captured title evidence", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
    scripts: ['{"jobKey":"titlejob11","title":"Shared Support Job"}'],
  });
  const heading = createElement({ text: "Shared Support Job", isHeading: true });
  const nearbyJobLink = {
    children: [],
    getAttribute: (name) => name === "href"
      ? "https://uk.indeed.com/viewjob?jk=stalejob11"
      : null,
    matches: (selector) => selector.includes("[href]"),
  };
  const card = createElement({ parent: body, heading });
  card.children.push(nearbyJobLink);
  heading.parentElement = card;

  companion.jobs.captureMenuContext(createElement({ parent: card }));

  assert.throws(
    () => companion.jobs.consumeMenuJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("stops nearby DOM discovery after the attribute-element budget", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=otherjob1",
  });
  let matchingElementsVisited = 0;
  let hrefsRead = 0;
  const attributeElements = Array.from({ length: 202 }, (_, index) => ({
    children: [],
    getAttribute(name) {
      if (name === "href") {
        hrefsRead += 1;
        return `https://uk.indeed.com/viewjob?jk=nearby${String(index).padStart(8, "0")}`;
      }
      return null;
    },
    matches(selector) {
      matchingElementsVisited += 1;
      return selector.includes("[href]");
    },
  }));
  const descendants = {
    children: attributeElements,
    matches: () => false,
  };
  const card = createElement({ parent: body });
  card.children = [descendants];

  companion.jobs.captureMenuContext(createElement({ parent: card }));

  assert.equal(matchingElementsVisited, 201);
  assert.equal(hrefsRead, 200);
  assert.throws(
    () => companion.jobs.consumeMenuJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("fails closed when captured context cannot be resolved safely", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=otherjob1",
  });
  const heading = createElement({ text: "Missing Shared Job", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;

  companion.jobs.captureMenuContext(createElement({ parent: card }));

  assert.throws(
    () => companion.jobs.consumeMenuJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("keeps captured menu context until the menu action consumes it", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=otherjob1",
    scripts: ['{"jobKey":"sharedjob1","title":"Shared Support Job"}'],
  });
  const heading = createElement({ text: "Shared Support Job", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;
  companion.jobs.captureMenuContext(createElement({ parent: card }));

  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=sharedjob1",
  );
  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=otherjob1",
  );
});

test("does not fall back to a different page job when captured context has no evidence", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=otherjob1",
  });
  companion.jobs.captureMenuContext(createElement({ parent: createElement({ parent: body }) }));

  assert.throws(
    () => companion.jobs.consumeMenuJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("fails closed when a captured title maps to multiple job keys", async () => {
  const { body, companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=manager",
    scripts: [
      '{"jobKey":"duplicate1","title":"Client Manager"}',
      '{"jobKey":"duplicate2","title":"Client Manager"}',
    ],
  });
  const heading = createElement({ text: "Client Manager", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;
  companion.jobs.captureMenuContext(createElement({ parent: card }));

  assert.throws(
    () => companion.jobs.consumeMenuJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("stops scanning embedded scripts as soon as the title mapping is ambiguous", async () => {
  const { body, companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=manager",
  });
  let laterScriptReads = 0;
  document.scripts = [
    { textContent: '{"jobKey":"earlyjob1","title":"Client Manager"}' },
    { textContent: '{"jobKey":"earlyjob2","title":"Client Manager"}' },
    { get textContent() { laterScriptReads += 1; return '{"jobKey":"laterjob3","title":"Client Manager"}'; } },
  ];
  captureTitle(companion, body, "Client Manager");

  assert.throws(
    () => companion.jobs.consumeMenuJobUrl(createElement()),
    /could not be identified safely/,
  );
  assert.equal(laterScriptReads, 0);
});

test("fails closed when the embedded candidate budget prevents a complete scan", async () => {
  const repeatedCandidate = '{"jobKey":"repeated1","title":"Client Manager"}';
  const { body, companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=manager",
  });
  let laterScriptReads = 0;
  document.scripts = [
    { textContent: Array.from({ length: 121 }, () => repeatedCandidate).join(",") },
    { get textContent() { laterScriptReads += 1; return repeatedCandidate; } },
  ];
  captureTitle(companion, body, "Client Manager");

  assert.throws(
    () => companion.jobs.consumeMenuJobUrl(createElement()),
    /could not be identified safely/,
  );
  assert.equal(laterScriptReads, 0);
});

test("accepts a complete embedded scan that exactly consumes the candidate budget", async () => {
  const repeatedCandidate = '{"jobKey":"repeated1","title":"Client Manager"}';
  const { body, companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=manager",
  });
  document.scripts = [
    { textContent: Array.from({ length: 120 }, () => repeatedCandidate).join(",") },
  ];
  captureTitle(companion, body, "Client Manager");

  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=repeated1",
  );
});

test("fails closed when visible and embedded title evidence identifies different jobs", async () => {
  const { body, companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
    scripts: ['{"jobKey":"embedded11","title":"Support Specialist"}'],
  });
  document.querySelectorAll = (selector) => (
    selector === companion.selectors.jobUrlCarrier
      ? [visibleJobCarrier("visible111", "Support Specialist")]
      : []
  );
  companion.dom.getViewportRect = () => ({ width: 500, height: 100, left: 0, top: 0 });
  captureTitle(companion, body, "Support Specialist");

  assert.throws(
    () => companion.jobs.consumeMenuJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("uses a unique visible title match when embedded title evidence is ambiguous", async () => {
  const { body, companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
    scripts: [
      '{"jobKey":"embedded11","title":"Support Specialist"}',
      '{"jobKey":"embedded22","title":"Support Specialist"}',
    ],
  });
  document.querySelectorAll = (selector) => (
    selector === companion.selectors.jobUrlCarrier
      ? [visibleJobCarrier("visible111", "Support Specialist")]
      : []
  );
  companion.dom.getViewportRect = () => ({ width: 500, height: 100, left: 0, top: 0 });
  captureTitle(companion, body, "Support Specialist");

  assert.equal(
    companion.jobs.consumeMenuJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=visible111",
  );
});

test("fails closed when visible title evidence is ambiguous", async () => {
  const { body, companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
  });
  let scriptReads = 0;
  document.scripts = [{
    get textContent() {
      scriptReads += 1;
      return '{"jobKey":"embedded11","title":"Support Specialist"}';
    },
  }];
  document.querySelectorAll = (selector) => (
    selector === companion.selectors.jobUrlCarrier
      ? [
          visibleJobCarrier("visible111", "Support Specialist"),
          visibleJobCarrier("visible222", "Support Specialist"),
        ]
      : []
  );
  companion.dom.getViewportRect = () => ({ width: 500, height: 100, left: 0, top: 0 });
  captureTitle(companion, body, "Support Specialist");

  assert.throws(
    () => companion.jobs.consumeMenuJobUrl(createElement()),
    /could not be identified safely/,
  );
  assert.equal(scriptReads, 0);
});

test("job-link collection defaults to all carriers and accepts an eligibility predicate", async () => {
  const { companion, document } = await createJobFixture({ href: "https://uk.indeed.com/jobs" });
  const first = visibleJobCarrier("first1111", "First job");
  const second = visibleJobCarrier("second111", "Second job");
  document.querySelectorAll = () => [first, second];
  assert.equal(companion.jobs.collectJobLinks().length, 2);
  const filtered = companion.jobs.collectJobLinks((element) => element === second);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].element, second);
});
