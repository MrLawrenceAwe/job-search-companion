import vm from "node:vm";

import { runScriptsInVm } from "./extension-scripts.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.textContent = "";
  }

  append(child) {
    this.children.push(child);
  }

  prepend(child) {
    this.children.unshift(child);
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  getAttribute(name) {
    return this[name] ?? null;
  }

  querySelector(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : null;
    return this.children.find((child) => child.className === className) || null;
  }

  remove() {
    this.removed = true;
  }
}

const loadMenuScripts = (context) =>
  runScriptsInVm(context, [
    "contracts/cv-fit-submissions.js",
    "cv-fit-submission.js",
    "job-url.js",
    "job-mark-store.js",
    "page-decorations.js", "job-marks.js",
    "job-menu.js",
  ]);

export const createMenuFixture = async ({
  runtime,
  jobUrl = "https://uk.indeed.com/viewjob?jk=fixture111",
  initialStorage = {},
}) => {
  const toasts = [];
  let insertedButton;
  let appliedButton;
  let unsuitableButton;
  const storage = initialStorage;
  const storageChanges = [];
  const location = new URL(jobUrl);
  const insertionRow = new FakeElement("div");
  insertionRow.textContent = location.hostname.endsWith("linkedin.com") ? "Share" : "WhatsApp";
  insertionRow.after = (element, applied, unsuitable) => {
    insertedButton = element;
    appliedButton = applied;
    unsuitableButton = unsuitable;
  };
  const document = {
    body: {
      appendChild(element) {
        toasts.push(element);
      },
    },
    createElement: (tagName) => new FakeElement(tagName),
    addEventListener() {},
    querySelector: (selector) =>
      selector === ".jsc-toast" ? toasts.findLast((element) => !element.removed) || null : null,
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    chrome: {
      runtime,
      storage: {
        local: {
          async get(key) {
            return key === null ? { ...storage } : { [key]: storage[key] };
          },
          async set(values) {
            Object.assign(storage, values);
          },
          async remove(key) {
            delete storage[key];
          },
        },
        onChanged: {
          addListener(listener) {
            storageChanges.push(listener);
          },
        },
      },
    },
    URL,
    console,
    document,
    location,
    window: {
      addEventListener() {},
      clearTimeout() {},
      location,
      setTimeout(callback, milliseconds) {
        if (milliseconds === 1000) {
          callback();
        }
      },
    },
    MutationObserver: class {
      disconnect() {}
      observe() {}
    },
  });
  await runScriptsInVm(context, [
    "contracts/job-urls.js",
    "contracts/blockers.js",
    "contracts/messages.js",
    "contracts/shortcuts.js",
    "extension-context.js",
    "feedback.js",
  ]);
  Object.assign(context.jobSearchCompanion.dom, {
    getViewportRect: () => ({ width: 200, height: 40 }),
    queryIncludingRoot: (root, selector) => selector === ".jsc-menu-item" ? [] : [root],
  });
  context.jobSearchCompanion.jobs.consumeMenuJobUrl = () => jobUrl;
  context.jobSearchCompanion.jobs.collectJobCarriers = () => [];
  await loadMenuScripts(context);
  context.jobSearchCompanion.jobMenu.insertJobMenuActions(insertionRow);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    button: insertedButton,
    appliedButton,
    unsuitableButton,
    storage,
    storageChanges,
    context,
    toasts,
  };
};

export const click = (button) =>
  button.listeners.click({
    preventDefault() {},
    stopPropagation() {},
  });

// Inspect the control contract rather than exposing the production record cache.
export const isJobMarked = (fixture, jobUrl, kind) =>
  fixture.context.jobSearchCompanion.jobMarks
    .createButton(jobUrl, kind)
    .getAttribute("aria-pressed") === "true";
