import vm from "node:vm";

import { runScriptsInVm } from "./extension-scripts.js";

export const createElement = ({
  text = "",
  parent = null,
  heading = null,
  isHeading = false,
} = {}) => ({
  childElementCount: heading ? 1 : 0,
  children: heading ? [heading] : [],
  parentElement: parent,
  textContent: text,
  title: "",
  closest: () => null,
  getAttribute: () => null,
  getBoundingClientRect: () => ({ width: 500, height: 200, left: 0, top: 0 }),
  matches: (selector) => isHeading && selector === "h1, h2, h3",
  querySelector: (selector) => selector === "h1, h2, h3" ? heading : null,
  querySelectorAll: () => [],
});

export const createJobFixture = async ({ href, scripts = [], canonicalUrl = null }) => {
  const body = createElement();
  const documentElement = createElement();
  const listeners = {};
  const windowListeners = {};
  const mutationObservers = [];
  const document = {
    body,
    documentElement,
    listeners,
    scripts: scripts.map((textContent) => ({ textContent })),
    addEventListener(type, listener) {
      (listeners[type] ||= []).push(listener);
    },
    querySelector: (selector) => (
      selector === 'link[rel="canonical"]' && canonicalUrl ? { href: canonicalUrl } : null
    ),
    querySelectorAll: () => [],
  };
  const location = new URL(href);
  const context = vm.createContext({
    URL,
    console,
    document,
    location,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        mutationObservers.push(this);
      }
      observe() { this.observing = true; }
      disconnect() { this.observing = false; }
      notify() { if (this.observing) this.callback(); }
    },
    window: {
      addEventListener(type, listener) {
        (windowListeners[type] ||= []).push(listener);
      },
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      innerWidth: 1440,
      location,
    },
  });

  await runScriptsInVm(context, [
    "contracts/job-urls.js",
    "contracts/blockers.js",
    "extension-context.js",
    "dom-visibility.js",
    "job-url.js",
    "job-resolution.js",
    "job-navigation.js",
  ]);

  return { body, companion: context.jobSearchCompanion, document, mutationObservers, location, windowListeners };
};
