import { readFile } from "node:fs/promises";
import vm from "node:vm";

export class FakeElement {
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

export const runExtensionScripts = async (context, filenames) => {
  for (const filename of filenames) {
    const source = await readFile(new URL(`../extension/${filename}`, import.meta.url), "utf8");
    vm.runInContext(source, context, { filename });
  }
};

export const loadMenuScripts = (context) => runExtensionScripts(context, [
  "submission.js",
  "job-url.js",
  "job-marks.js",
  "share-menu.js",
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
    querySelector: (selector) => selector === ".cv-fit-bridge-toast"
      ? toasts.findLast((element) => !element.removed) || null
      : null,
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    chrome: {
      runtime,
      storage: {
        local: {
          async get(key) { return key === null ? { ...storage } : { [key]: storage[key] }; },
          async set(values) { Object.assign(storage, values); },
          async remove(key) { delete storage[key]; },
        },
        onChanged: { addListener(listener) { storageChanges.push(listener); } },
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
  await runExtensionScripts(context, ["extension-context.js"]);
  Object.assign(context.cvFitBridge.dom, {
    getVisibleRect: () => ({ width: 200, height: 40 }),
    queryIncludingRoot: (root) => [root],
  });
  context.cvFitBridge.jobs.resolveJobUrl = () => jobUrl;
  context.cvFitBridge.jobs.collectJobs = () => [];
  await loadMenuScripts(context);
  context.cvFitBridge.shareMenu.insertMenuItem(insertionRow);
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

export const click = (button) => button.listeners.click({
  preventDefault() {},
  stopPropagation() {},
});

export const flushUntil = async (condition, attempts = 30) => {
  for (let attempt = 0; attempt < attempts && !condition(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
