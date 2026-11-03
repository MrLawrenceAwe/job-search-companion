import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const extensionDirectory = new URL("../extension/", import.meta.url);

export const loadWorker = async (fetch) => {
  const storage = {};
  const storageReads = [];
  let messageHandler;
  let timeoutCallback;
  let clearedTimer;
  const context = vm.createContext({
    AbortController,
    AbortSignal,
    URL,
    clearTimeout: (timer) => { clearedTimer = timer; },
    chrome: {
      storage: { local: {
        get: async (keys = null) => {
          storageReads.push(keys);
          if (keys === null) return { ...storage };
          const names = typeof keys === "string" ? [keys] : keys;
          return Object.fromEntries(names.filter((key) => key in storage).map((key) => [key, storage[key]]));
        },
        set: async (values) => Object.assign(storage, values),
      } },
      runtime: {
        getURL: (path) => `chrome-extension://test/${path}`,
        onMessage: {
          addListener: (handler) => { messageHandler = handler; },
        },
      },
    },
    fetch,
    importScripts: (...filenames) => {
      for (const filename of filenames) {
        if (filename === "local-config.js") {
          Object.assign(context.jobSearchBridgeConfig, {
            bridgeToken: "test-token",
            bridgeOrigin: "http://127.0.0.1:48973",
          });
        } else {
          const source = readFileSync(new URL(filename, extensionDirectory), "utf8");
          vm.runInContext(source, context, { filename });
        }
      }
    },
    setTimeout: (callback) => {
      timeoutCallback = callback;
      return 17;
    },
  });
  const source = readFileSync(new URL("service-worker.js", extensionDirectory), "utf8");
  vm.runInContext(source, context, { filename: "service-worker.js" });
  const request = (message) => new Promise((resolve) => {
    assert.equal(messageHandler(message, {}, resolve), true);
  });
  return {
    get clearedTimer() { return clearedTimer; },
    get timeoutCallback() { return timeoutCallback; },
    request,
    messageHandler,
    storage,
    storageReads,
  };
};
