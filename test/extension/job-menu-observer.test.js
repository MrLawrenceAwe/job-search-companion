import assert from "node:assert/strict";
import { runScriptsInVm } from "../../test-support/extension-scripts.js";
import test from "node:test";
import vm from "node:vm";

test("retries document-wide menu discovery throughout the bounded scan window", async () => {
  const scheduledCallbacks = [];
  let clickHandler;
  let documentQueries = 0;
  let currentTime = 0;
  let observeCount = 0;
  let disconnectCount = 0;

  class Element {}
  class MutationObserver {
    observe() { observeCount += 1; }
    disconnect() { disconnectCount += 1; }
  }

  const document = {
    body: new Element(),
    documentElement: new Element(),
    addEventListener: (_type, handler) => { clickHandler = handler; },
    querySelectorAll: () => {
      documentQueries += 1;
      return [];
    },
  };
  const context = vm.createContext({
    console,
    Date: { now: () => currentTime },
    document,
    Element,
    MutationObserver,
    jobSearchCompanion: {
      dom: { getViewportRect: () => ({ width: 1, height: 1 }) },
      jobs: { captureMenuContext: () => {}, consumeMenuJobUrl: () => "https://uk.indeed.com/viewjob?jk=fixture111" },
      jobMarks: { createButton() { return new Element(); } },
      jobMenu: {
        insertJobMenuActions: () => false,
        mightContainMenu: () => false,
        findMenuRoot: () => null,
      },
      jobMenuDetection: { retryIntervalMs: 120, scanWindowMs: 1800 },
      selectors: { menuContext: '[role="menu"]' },
      ui: { menuItemClass: "jsc-menu-item" },
    },
    window: {
      clearTimeout: () => {},
      setTimeout: (callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      },
    },
  });

  await runScriptsInVm(context, ["job-menu-observer.js"]);
  assert.equal(observeCount, 0);

  const shareButton = {
    getAttribute: () => "Share",
    textContent: "",
  };
  clickHandler({ target: { closest: () => shareButton } });
  assert.equal(observeCount, 1);

  scheduledCallbacks.shift()();
  scheduledCallbacks.shift()();
  scheduledCallbacks.shift()();

  assert.equal(documentQueries, 3);
  assert.equal(disconnectCount, 0);

  currentTime = 1801;
  scheduledCallbacks.shift()();
  assert.equal(documentQueries, 4);
  assert.equal(disconnectCount, 1);
});

test("discovers a menu that becomes visible without a child-list mutation", async () => {
  const scheduledCallbacks = [];
  let clickHandler;
  let queryCount = 0;
  let insertedIntoMenu = false;

  class Element {
    constructor({ textContent = "" } = {}) {
      this.childElementCount = 0;
      this.textContent = textContent;
    }

    appendChild() {
      insertedIntoMenu = true;
    }

    addEventListener() {}
    append() {}
    matches() {
      return false;
    }
    prepend() {}

    querySelector() {
      return null;
    }

    querySelectorAll() {
      return [];
    }

    setAttribute() {}
  }
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  const delayedMenu = new Element({ textContent: "Copy link Email WhatsApp" });
  const document = {
    body: new Element(),
    documentElement: new Element(),
    addEventListener: (_type, handler) => { clickHandler = handler; },
    createElement: () => new Element(),
    querySelectorAll: (selector) => {
      if (selector !== '[role="menu"]') {
        return [];
      }
      queryCount += 1;
      return queryCount >= 2 ? [delayedMenu] : [];
    },
  };
  const context = vm.createContext({
    console,
    Date,
    document,
    Element,
    MutationObserver,
    jobSearchCompanion: {
      dom: {
        getViewportRect: () => ({ width: 100, height: 100 }),
        queryIncludingRoot: (root) => [root],
      },
      jobs: { captureMenuContext: () => {}, consumeMenuJobUrl: () => "https://uk.indeed.com/viewjob?jk=fixture111" },
      jobMarks: { createButton() { return new Element(); } },
      jobMenu: {},
      jobMenuDetection: {
        retryIntervalMs: 120,
        scanWindowMs: 1800,
        textPattern: /Copy link[\s\S]*Email[\s\S]*WhatsApp/,
      },
      showToast: () => {},
      selectors: { menuContext: '[role="menu"]' },
      cvFitSubmissions: {},
      ui: {
        cvFitActionLabel: "Analyse with CV Fit Advisor",
        menuItemClass: "jsc-menu-item",
      },
    },
    window: {
      clearTimeout: () => {},
      setTimeout: (callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      },
    },
  });

  await runScriptsInVm(context, ["contracts/shortcuts.js", "job-menu.js", "job-menu-observer.js"]);
  clickHandler({
    target: {
      closest: () => ({ getAttribute: () => "Share", textContent: "" }),
    },
  });

  scheduledCallbacks.shift()();
  assert.equal(insertedIntoMenu, false);
  scheduledCallbacks.shift()();
  assert.equal(insertedIntoMenu, true);
});
