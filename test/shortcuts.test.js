import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const loadShortcuts = async () => {
  let keydownHandler;
  const hides = [];
  const navigations = [];
  const submissions = [];
  const toasts = [];
  const undos = [];

  class Element {
    constructor({ editable = false } = {}) {
      this.editable = editable;
    }

    closest() {
      return this.editable ? this : null;
    }
  }

  const activeElement = new Element();
  const context = vm.createContext({
    console,
    document: {
      activeElement,
      addEventListener(type, handler) {
        if (type === "keydown") {
          keydownHandler = handler;
        }
      },
    },
    Element,
    jobSearchCompanion: {
      jobs: {
        hideCurrentJob() {
          hides.push(true);
          return true;
        },
        navigateJob(direction) {
          navigations.push(direction);
          return true;
        },
        resolveSelectedJobUrl() {
          return "https://uk.indeed.com/viewjob?jk=shortcut111";
        },
        undoLastJobAction() {
          undos.push(true);
          return true;
        },
      },
      showToast(message, kind) {
        toasts.push({ message, kind });
      },
      submissions: {
        submit(jobUrl) {
          submissions.push(jobUrl);
        },
      },
    },
  });

  const source = await readFile(new URL("../extension/shortcuts.js", import.meta.url), "utf8");
  vm.runInContext(source, context, { filename: "shortcuts.js" });
  return {
    Element,
    context,
    hides,
    keydownHandler,
    navigations,
    submissions,
    toasts,
    undos,
  };
};

const shortcutEvent = (target, overrides = {}) => {
  const calls = [];
  return {
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    code: "KeyN",
    key: "n",
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    target,
    preventDefault: () => calls.push("preventDefault"),
    stopPropagation: () => calls.push("stopPropagation"),
    calls,
    ...overrides,
  };
};

test("N submits the current job", async () => {
  const fixture = await loadShortcuts();
  const event = shortcutEvent(new fixture.Element());

  fixture.keydownHandler(event);

  assert.deepEqual(event.calls, ["preventDefault", "stopPropagation"]);
  assert.deepEqual(
    fixture.submissions,
    ["https://uk.indeed.com/viewjob?jk=shortcut111"],
  );
});

test("N does not fire while typing, with modifiers, or for repeated keydown events", async () => {
  const fixture = await loadShortcuts();

  fixture.keydownHandler(shortcutEvent(new fixture.Element({ editable: true })));
  fixture.keydownHandler(shortcutEvent(new fixture.Element(), { metaKey: true }));
  fixture.keydownHandler(shortcutEvent(new fixture.Element(), { repeat: true }));

  assert.deepEqual(fixture.submissions, []);
});

test("J and K navigate to the next and previous rendered jobs", async () => {
  const fixture = await loadShortcuts();
  const nextEvent = shortcutEvent(new fixture.Element(), {
    altKey: false,
    shiftKey: false,
    code: "KeyJ",
    key: "j",
  });
  const previousEvent = shortcutEvent(new fixture.Element(), {
    altKey: false,
    shiftKey: false,
    code: "KeyK",
    key: "k",
  });

  fixture.keydownHandler(nextEvent);
  fixture.keydownHandler(previousEvent);

  assert.deepEqual(fixture.navigations, [1, -1]);
  assert.deepEqual(nextEvent.calls, ["preventDefault", "stopPropagation"]);
  assert.deepEqual(previousEvent.calls, ["preventDefault", "stopPropagation"]);
});

test("J and K navigation ignores editable fields and modified keys", async () => {
  const fixture = await loadShortcuts();

  fixture.keydownHandler(shortcutEvent(new fixture.Element({ editable: true }), {
    altKey: false,
    shiftKey: false,
    code: "KeyJ",
    key: "j",
  }));
  fixture.keydownHandler(shortcutEvent(new fixture.Element(), {
    altKey: false,
    shiftKey: false,
    ctrlKey: true,
    code: "KeyK",
    key: "k",
  }));

  assert.deepEqual(fixture.navigations, []);
});

test("H hides the current job and U undoes the latest job action", async () => {
  const fixture = await loadShortcuts();
  const hideEvent = shortcutEvent(new fixture.Element(), {
    code: "KeyH",
    key: "h",
  });
  const undoEvent = shortcutEvent(new fixture.Element(), {
    code: "KeyU",
    key: "u",
  });

  fixture.keydownHandler(hideEvent);
  fixture.keydownHandler(undoEvent);

  assert.deepEqual(fixture.hides, [true]);
  assert.deepEqual(fixture.undos, [true]);
  assert.deepEqual(hideEvent.calls, ["preventDefault", "stopPropagation"]);
  assert.deepEqual(undoEvent.calls, ["preventDefault", "stopPropagation"]);
});

test("shortcut reports a job-resolution failure without submitting", async () => {
  const fixture = await loadShortcuts();
  fixture.context.jobSearchCompanion.jobs.resolveSelectedJobUrl = () => {
    throw new Error("ambiguous job");
  };

  fixture.keydownHandler(shortcutEvent(new fixture.Element()));

  assert.deepEqual(fixture.submissions, []);
  assert.equal(JSON.stringify(fixture.toasts), JSON.stringify([{
    message: "Couldn’t identify the current job.",
    kind: "error",
  }]));
});
