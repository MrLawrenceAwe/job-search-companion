import assert from "node:assert/strict";
import test from "node:test";

import { createElement, createJobFixture } from "../test-support/job-fixture.js";

const captureTitle = (cvFit, body, title) => {
  const heading = createElement({ text: title, isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;
  cvFit.jobs.captureShareContext(createElement({ parent: card }));
};

const visibleJobCarrier = (jobKey, title) => ({
  children: [],
  parentElement: null,
  textContent: title,
  title: "",
  getAttribute: (name) => name === "href" ? `/viewjob?jk=${jobKey}` : null,
  matches: (selector) => selector.includes("[href]"),
});

test("resolves an embedded job key using the captured share context", async () => {
  const { body, cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
    scripts: ['{"jobKey":"fixture123","title":"Senior Support Specialist"}'],
  });
  const heading = createElement({ text: "Senior Support Specialist", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;
  const shareButton = createElement({ parent: card });

  cvFit.jobs.captureShareContext(shareButton);

  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=fixture123",
  );
});

test("ignores Indeed's detail-heading suffix when resolving the shared job", async () => {
  const { body, cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/?vjk=03eef228667e3e0d",
    scripts: ['{"jobKey":"03eef228667e3e0d","displayTitle":"Project Administrator"}'],
  });
  const heading = createElement({ text: "Project Administrator - job post", isHeading: true });
  const detailHeader = createElement({ parent: body, heading });
  heading.parentElement = detailHeader;

  cvFit.jobs.captureShareContext(createElement({ parent: detailHeader }));

  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=03eef228667e3e0d",
  );
});

test("falls back to the canonical job URL", async () => {
  const { cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
    canonicalUrl: "https://uk.indeed.com/viewjob?jk=canonical1&utm_source=test",
  });

  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=canonical1",
  );
});

test("does not treat arbitrary Indeed pages with a job-like query as job pages", async () => {
  const { cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/company?jk=canonical1",
  });

  assert.equal(
    cvFit.jobs.jobUrlFromIndeedPageUrl("https://uk.indeed.com/company?jk=canonical1"),
    null,
  );
});

test("resolves a LinkedIn detail-page job URL", async () => {
  const { cvFit } = await createJobFixture({
    href: "https://www.linkedin.com/jobs/view/4447780789/?trackingId=ignored",
  });

  assert.equal(
    cvFit.jobs.resolveCurrentJobUrl(),
    "https://www.linkedin.com/jobs/view/4447780789/",
  );
});

test("resolves the selected LinkedIn job from currentJobId", async () => {
  const { cvFit } = await createJobFixture({
    href: "https://www.linkedin.com/jobs/search-results/?currentJobId=4447780789&keywords=qa",
  });

  assert.equal(
    cvFit.jobs.resolveCurrentJobUrl(),
    "https://www.linkedin.com/jobs/view/4447780789/",
  );
});

test("keeps the LinkedIn job selected when its More options menu opens", async () => {
  const { body, cvFit } = await createJobFixture({
    href: "https://www.linkedin.com/jobs/search-results/?currentJobId=4447780789",
  });

  cvFit.jobs.captureShareContext(createElement({ parent: body }));

  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://www.linkedin.com/jobs/view/4447780789/",
  );
});

test("prefers the exact job key in the results-page URL", async () => {
  const { cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=detailpane1",
    scripts: ['{"jobKey":"unrelated1","title":"Another Job"}'],
  });

  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=detailpane1",
  );
});

test("prefers captured share context over a different results-page job", async () => {
  const { body, cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=otherjob1",
    scripts: ['{"jobKey":"sharedjob1","title":"Shared Support Job"}'],
  });
  const heading = createElement({ text: "Shared Support Job", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;

  cvFit.jobs.captureShareContext(createElement({ parent: card }));

  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=sharedjob1",
  );
});

test("resolves the current job independently of stale share-menu context", async () => {
  const { body, cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=currentjob1",
    scripts: ['{"jobKey":"sharedjob1","title":"Previously Shared Job"}'],
  });
  const heading = createElement({ text: "Previously Shared Job", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;
  cvFit.jobs.captureShareContext(createElement({ parent: card }));

  assert.equal(
    cvFit.jobs.resolveCurrentJobUrl(),
    "https://uk.indeed.com/viewjob?jk=currentjob1",
  );
  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=sharedjob1",
  );
});

test("uses title evidence to disambiguate multiple job URLs near the share button", async () => {
  const { body, cvFit } = await createJobFixture({
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

  cvFit.jobs.captureShareContext(createElement({ parent: card }));

  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=sharedjob1",
  );
});

test("fails closed when a single nearby URL conflicts with captured title evidence", async () => {
  const { body, cvFit } = await createJobFixture({
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

  cvFit.jobs.captureShareContext(createElement({ parent: card }));

  assert.throws(
    () => cvFit.jobs.resolveJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("stops nearby DOM discovery after the attribute-element budget", async () => {
  const { body, cvFit } = await createJobFixture({
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

  cvFit.jobs.captureShareContext(createElement({ parent: card }));

  assert.equal(matchingElementsVisited, 201);
  assert.equal(hrefsRead, 200);
  assert.throws(
    () => cvFit.jobs.resolveJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("fails closed when captured context cannot be resolved safely", async () => {
  const { body, cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=otherjob1",
  });
  const heading = createElement({ text: "Missing Shared Job", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;

  cvFit.jobs.captureShareContext(createElement({ parent: card }));

  assert.throws(
    () => cvFit.jobs.resolveJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("keeps captured share context until the menu action consumes it", async () => {
  const { body, cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=otherjob1",
    scripts: ['{"jobKey":"sharedjob1","title":"Shared Support Job"}'],
  });
  const heading = createElement({ text: "Shared Support Job", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;
  cvFit.jobs.captureShareContext(createElement({ parent: card }));

  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=sharedjob1",
  );
  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=otherjob1",
  );
});

test("does not fall back to a different page job when captured context has no evidence", async () => {
  const { body, cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=otherjob1",
  });
  cvFit.jobs.captureShareContext(createElement({ parent: createElement({ parent: body }) }));

  assert.throws(
    () => cvFit.jobs.resolveJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("fails closed when a captured title maps to multiple job keys", async () => {
  const { body, cvFit } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=manager",
    scripts: [
      '{"jobKey":"duplicate1","title":"Client Manager"}',
      '{"jobKey":"duplicate2","title":"Client Manager"}',
    ],
  });
  const heading = createElement({ text: "Client Manager", isHeading: true });
  const card = createElement({ parent: body, heading });
  heading.parentElement = card;
  cvFit.jobs.captureShareContext(createElement({ parent: card }));

  assert.throws(
    () => cvFit.jobs.resolveJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("stops scanning embedded scripts as soon as the title mapping is ambiguous", async () => {
  const { body, cvFit, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=manager",
  });
  let laterScriptReads = 0;
  document.scripts = [
    { textContent: '{"jobKey":"earlyjob1","title":"Client Manager"}' },
    { textContent: '{"jobKey":"earlyjob2","title":"Client Manager"}' },
    { get textContent() { laterScriptReads += 1; return '{"jobKey":"laterjob3","title":"Client Manager"}'; } },
  ];
  captureTitle(cvFit, body, "Client Manager");

  assert.throws(
    () => cvFit.jobs.resolveJobUrl(createElement()),
    /could not be identified safely/,
  );
  assert.equal(laterScriptReads, 0);
});

test("fails closed when the embedded candidate budget prevents a complete scan", async () => {
  const repeatedCandidate = '{"jobKey":"repeated1","title":"Client Manager"}';
  const { body, cvFit, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=manager",
  });
  let laterScriptReads = 0;
  document.scripts = [
    { textContent: Array.from({ length: 121 }, () => repeatedCandidate).join(",") },
    { get textContent() { laterScriptReads += 1; return repeatedCandidate; } },
  ];
  captureTitle(cvFit, body, "Client Manager");

  assert.throws(
    () => cvFit.jobs.resolveJobUrl(createElement()),
    /could not be identified safely/,
  );
  assert.equal(laterScriptReads, 0);
});

test("accepts a complete embedded scan that exactly consumes the candidate budget", async () => {
  const repeatedCandidate = '{"jobKey":"repeated1","title":"Client Manager"}';
  const { body, cvFit, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=manager",
  });
  document.scripts = [
    { textContent: Array.from({ length: 120 }, () => repeatedCandidate).join(",") },
  ];
  captureTitle(cvFit, body, "Client Manager");

  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=repeated1",
  );
});

test("fails closed when visible and embedded title evidence identifies different jobs", async () => {
  const { body, cvFit, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
    scripts: ['{"jobKey":"embedded11","title":"Support Specialist"}'],
  });
  document.querySelectorAll = (selector) => (
    selector === cvFit.selectors.jobUrlCarrier
      ? [visibleJobCarrier("visible111", "Support Specialist")]
      : []
  );
  cvFit.dom.getVisibleRect = () => ({ width: 500, height: 100, left: 0, top: 0 });
  captureTitle(cvFit, body, "Support Specialist");

  assert.throws(
    () => cvFit.jobs.resolveJobUrl(createElement()),
    /could not be identified safely/,
  );
});

test("uses a unique visible title match when embedded title evidence is ambiguous", async () => {
  const { body, cvFit, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
    scripts: [
      '{"jobKey":"embedded11","title":"Support Specialist"}',
      '{"jobKey":"embedded22","title":"Support Specialist"}',
    ],
  });
  document.querySelectorAll = (selector) => (
    selector === cvFit.selectors.jobUrlCarrier
      ? [visibleJobCarrier("visible111", "Support Specialist")]
      : []
  );
  cvFit.dom.getVisibleRect = () => ({ width: 500, height: 100, left: 0, top: 0 });
  captureTitle(cvFit, body, "Support Specialist");

  assert.equal(
    cvFit.jobs.resolveJobUrl(createElement()),
    "https://uk.indeed.com/viewjob?jk=visible111",
  );
});

test("fails closed when visible title evidence is ambiguous", async () => {
  const { body, cvFit, document } = await createJobFixture({
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
    selector === cvFit.selectors.jobUrlCarrier
      ? [
          visibleJobCarrier("visible111", "Support Specialist"),
          visibleJobCarrier("visible222", "Support Specialist"),
        ]
      : []
  );
  cvFit.dom.getVisibleRect = () => ({ width: 500, height: 100, left: 0, top: 0 });
  captureTitle(cvFit, body, "Support Specialist");

  assert.throws(
    () => cvFit.jobs.resolveJobUrl(createElement()),
    /could not be identified safely/,
  );
  assert.equal(scriptReads, 0);
});
