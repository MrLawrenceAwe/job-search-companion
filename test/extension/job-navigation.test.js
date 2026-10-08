import assert from "node:assert/strict";
import test from "node:test";

import { createJobFixture } from "../../test-support/job-fixture.js";

test("rendered-job navigation starts at the top after page load", async () => {
  const { companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=visiblejob2",
  });
  const clicked = [];
  const makeJobLink = (jobKey) => ({
    children: [],
    click: () => clicked.push(jobKey),
    focus() {},
    getAttribute: (name) => name === "href" ? `/viewjob?jk=${jobKey}` : null,
    matches: (selector) => selector.includes("a[href]") || selector.includes("[href]"),
    querySelector: () => null,
    scrollIntoView() {},
  });
  const jobLinks = [
    makeJobLink("visiblejob1"),
    makeJobLink("visiblejob2"),
    makeJobLink("visiblejob3"),
  ];
  document.querySelectorAll = (selector) => (
    selector === companion.selectors.jobUrlCarrier ? jobLinks : []
  );
  companion.dom.getViewportRect = () => null;
  companion.dom.getRenderedRect = () => ({ width: 500, height: 100, left: 0, top: 0 });

  assert.equal(companion.jobs.navigateJob(-1), false);
  document.listeners.click[0]({ isTrusted: true, target: jobLinks[2] });
  assert.equal(companion.jobs.navigateJob(1), true);
  assert.equal(companion.jobs.navigateJob(1), true);
  assert.equal(companion.jobs.navigateJob(-1), true);
  assert.deepEqual(clicked, ["visiblejob1", "visiblejob2", "visiblejob1"]);
});

test("submission resolves the navigated job while the results URL is still stale", async () => {
  const { companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=visiblejob2",
  });
  const clicked = [];
  const jobLinks = ["visiblejob1", "visiblejob2"].map((jobKey) => ({
    children: [],
    click: () => clicked.push(jobKey),
    focus() {},
    scrollIntoView() {},
    getAttribute: (name) => name === "href" ? `/viewjob?jk=${jobKey}` : null,
    matches: () => true,
    querySelector: () => null,
  }));
  document.querySelectorAll = (selector) => (
    selector === companion.selectors.jobUrlCarrier ? jobLinks : []
  );
  companion.dom.getRenderedRect = () => ({ width: 500, height: 100 });

  assert.equal(companion.jobs.navigateJob(1), true);
  assert.deepEqual(clicked, ["visiblejob1"]);
  assert.equal(companion.jobs.resolveSelectedJobUrl(), "https://uk.indeed.com/viewjob?jk=visiblejob1");
  assert.equal(companion.jobs.resolvePageJobUrl(), "https://uk.indeed.com/viewjob?jk=visiblejob2");

  companion.jobs.jobUrlFromPageUrl = () => "https://uk.indeed.com/viewjob?jk=visiblejob3";
  assert.equal(companion.jobs.resolveSelectedJobUrl(), "https://uk.indeed.com/viewjob?jk=visiblejob3");
});

test("rendered-job navigation stops at the results boundary", async () => {
  const { companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=visiblejob1",
  });
  const jobLink = {
    children: [],
    click() {},
    getAttribute: (name) => name === "href" ? "/viewjob?jk=visiblejob1" : null,
    matches: (selector) => selector.includes("a[href]") || selector.includes("[href]"),
  };
  document.querySelectorAll = (selector) => (
    selector === companion.selectors.jobUrlCarrier ? [jobLink] : []
  );
  companion.dom.getViewportRect = () => ({ width: 500, height: 100, left: 0, top: 0 });
  companion.dom.getRenderedRect = () => ({ width: 500, height: 100, left: 0, top: 0 });

  assert.equal(companion.jobs.navigateJob(-1), false);
  assert.equal(companion.jobs.navigateJob(1), true);
  assert.equal(companion.jobs.navigateJob(1), false);
  assert.equal(companion.jobs.navigateJob(-1), false);
});

test("mouse selection replaces stale keyboard navigation state", async () => {
  const { companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=visiblejob2",
  });
  const clicked = [];
  const makeJob = (jobKey) => {
    const classes = new Set();
    const card = {
      classList: {
        add: (className) => classes.add(className),
        contains: (className) => classes.has(className),
        remove: (className) => classes.delete(className),
      },
    };
    const link = {
      card,
      children: [],
      click: () => clicked.push(jobKey),
      closest: (selector) => (
        selector === companion.selectors.jobUrlCarrier ? link : card
      ),
      contains: () => false,
      focus() {},
      getAttribute: (name) => name === "href" ? `/viewjob?jk=${jobKey}` : null,
      matches: (selector) => selector.includes("a[href]") || selector.includes("[href]"),
      querySelector: () => null,
      scrollIntoView() {},
    };
    return { card, link };
  };
  const jobs = [
    makeJob("visiblejob1"),
    makeJob("visiblejob2"),
    makeJob("visiblejob3"),
  ];
  document.querySelectorAll = (selector) => (
    selector === companion.selectors.jobUrlCarrier ? jobs.map(({ link }) => link) : []
  );
  companion.dom.getRenderedRect = (element) => (
    element.card.classList.contains("jsc-hidden-job")
      ? null
      : { width: 500, height: 100, left: 0, top: 0 }
  );

  assert.equal(companion.jobs.navigateJob(1), true);
  document.listeners.click[0]({ isTrusted: true, target: jobs[2].link });
  assert.equal(companion.jobs.hideCurrentJob(), true);

  assert.equal(jobs[0].card.classList.contains("jsc-hidden-job"), false);
  assert.equal(jobs[2].card.classList.contains("jsc-hidden-job"), true);
  assert.deepEqual(clicked, ["visiblejob1", "visiblejob2"]);
});

test("undo reverses mixed navigation and hide actions in order", async () => {
  const { companion, document } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support&vjk=visiblejob2",
  });
  const clicked = [];
  const makeJob = (jobKey) => {
    const classes = new Set();
    const card = {
      classList: {
        add: (className) => classes.add(className),
        contains: (className) => classes.has(className),
        remove: (className) => classes.delete(className),
      },
    };
    const link = {
      card,
      children: [],
      click: () => clicked.push(jobKey),
      closest: () => card,
      focus() {},
      getAttribute: (name) => name === "href" ? `/viewjob?jk=${jobKey}` : null,
      matches: (selector) => selector.includes("a[href]") || selector.includes("[href]"),
      querySelector: () => null,
      scrollIntoView() {},
    };
    return { card, link };
  };
  const jobs = [
    makeJob("visiblejob1"),
    makeJob("visiblejob2"),
    makeJob("visiblejob3"),
  ];
  document.querySelectorAll = (selector) => (
    selector === companion.selectors.jobUrlCarrier ? jobs.map(({ link }) => link) : []
  );
  companion.dom.getRenderedRect = (element) => (
    element.card.classList.contains("jsc-hidden-job")
      ? null
      : { width: 500, height: 100, left: 0, top: 0 }
  );

  assert.equal(companion.jobs.navigateJob(1), true);
  assert.equal(companion.jobs.hideCurrentJob(), true);
  assert.equal(jobs[0].card.classList.contains("jsc-hidden-job"), true);
  assert.equal(companion.jobs.navigateJob(1), true);
  assert.equal(companion.jobs.undoLastJobAction(), true);
  assert.equal(companion.jobs.undoLastJobAction(), true);

  assert.equal(jobs[0].card.classList.contains("jsc-hidden-job"), false);
  assert.deepEqual(clicked, [
    "visiblejob1",
    "visiblejob2",
    "visiblejob3",
    "visiblejob2",
    "visiblejob1",
  ]);
});

test("hiding a result excludes duplicate links for that job from navigation", async () => {
  const { companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
  });
  const clicked = [];
  const makeJob = (jobKey, kind) => {
    const classes = new Set();
    const container = {
      classList: {
        add: (className) => classes.add(className),
        remove: (className) => classes.delete(className),
      },
    };
    const element = {
      children: [],
      click: () => clicked.push(kind),
      closest: () => container,
      focus() {},
      matches: () => true,
      scrollIntoView() {},
    };
    return { jobUrl: `https://uk.indeed.com/viewjob?jk=${jobKey}`, element };
  };
  const resultCard = makeJob("visiblejob1", "result-card");
  const detailLink = makeJob("visiblejob1", "detail-pane");
  companion.jobs.collectJobLinks = () => [resultCard, detailLink];

  assert.equal(companion.jobs.navigateJob(1), true);
  assert.equal(companion.jobs.hideCurrentJob(), true);
  assert.equal(companion.jobs.navigateJob(1), false);
  assert.deepEqual(clicked, ["result-card"]);
});

test("undo resolves a replacement card after the results list rerenders", async () => {
  const { companion } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
  });
  const clicked = [];
  const makeJob = (jobKey, label) => {
    const classes = new Set();
    const container = {
      classList: {
        add: (className) => classes.add(className),
        remove: (className) => classes.delete(className),
      },
    };
    const element = {
      children: [],
      click: () => clicked.push(label),
      closest: () => container,
      focus() {},
      matches: () => true,
      scrollIntoView() {},
    };
    return { jobUrl: `https://uk.indeed.com/viewjob?jk=${jobKey}`, element };
  };
  let jobs = [makeJob("visiblejob1", "original")];
  companion.jobs.collectJobLinks = () => jobs;

  assert.equal(companion.jobs.navigateJob(1), true);
  assert.equal(companion.jobs.hideCurrentJob(), true);
  jobs = [makeJob("visiblejob1", "replacement")];

  assert.equal(companion.jobs.undoLastJobAction(), true);
  assert.deepEqual(clicked, ["original", "replacement"]);
});

test("a hidden job stays hidden when its card is replaced", async () => {
  const { companion, mutationObservers } = await createJobFixture({
    href: "https://uk.indeed.com/jobs?q=support",
  });
  const makeJob = (jobKey) => {
    const classes = new Set();
    const container = {
      classList: {
        add: (className) => classes.add(className),
        remove: (className) => classes.delete(className),
        contains: (className) => classes.has(className),
      },
    };
    const element = {
      closest: () => container,
      click() {},
      focus() {},
      matches: () => true,
      scrollIntoView() {},
    };
    return { jobUrl: `https://uk.indeed.com/viewjob?jk=${jobKey}`, element, container };
  };
  let jobs = [makeJob("visiblejob1")];
  companion.jobs.collectJobLinks = (isEligible) => jobs.filter(({ container }) => (
    !container.classList.contains("jsc-hidden-job")
      || isEligible !== companion.dom.getRenderedRect
  ));

  assert.equal(companion.jobs.navigateJob(1), true);
  assert.equal(companion.jobs.hideCurrentJob(), true);
  assert.equal(mutationObservers[0].observing, true);

  jobs = [makeJob("visiblejob1")];
  mutationObservers[0].notify();
  assert.equal(jobs[0].container.classList.contains("jsc-hidden-job"), true);

  assert.equal(companion.jobs.undoLastJobAction(), true);
  assert.equal(jobs[0].container.classList.contains("jsc-hidden-job"), false);
  assert.equal(mutationObservers[0].observing, false);
});
