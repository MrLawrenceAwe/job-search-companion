import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
import { readExtensionScript } from "./extension-scripts.js";

export const loadWorker = async (fetch) => {
  const storage = {};
  let messageHandler;
  let timeoutCallback;
  let clearedTimer;
  const sources = new Map(await Promise.all([
    ...["job-urls", "job-storage-keys", "indeed-availability", "identifiers", "job-analyses", "messages"].map((name) => `contracts/${name}.js`),
    "bridge-config.js",
    ...(await readdir(new URL("../extension/worker/", import.meta.url))).map((name) => `worker/${name}`),
  ].map(async (filename) => [filename, await readExtensionScript(filename)])));
  const context = vm.createContext({
    AbortController,
    AbortSignal,
    URL,
    clearTimeout: (timer) => { clearedTimer = timer; },
    chrome: {
      storage: { local: { get: async () => ({ ...storage }), set: async (values) => Object.assign(storage, values) } },
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
          assert.ok(sources.has(filename), `Unexpected worker dependency: ${filename}`);
          vm.runInContext(sources.get(filename), context, { filename });
        }
      }
    },
    setTimeout: (callback) => {
      timeoutCallback = callback;
      return 17;
    },
  });
  const source = await readFile(new URL("../extension/service-worker.js", import.meta.url), "utf8");
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
  };
};
