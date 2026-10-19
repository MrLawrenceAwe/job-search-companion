(() => {
  globalThis.jobSearchWorkerModules ??= {};
  globalThis.jobSearchWorkerModules.createBridgeClient = ({ bridgeConfig }) => {
    const REQUEST_TIMEOUT_MS = 10_000;
    const requestBridgeJson = async (endpoint, { method, body: requestBody }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          method,
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-JSC-Token": bridgeConfig.bridgeToken,
          },
          ...(method === "POST" ? { body: JSON.stringify(requestBody) } : {}),
        });
        let parseError = null;
        const body = await response.json().catch((error) => {
          parseError = error;
          return null;
        });
        return { response, body, parseError };
      } finally {
        clearTimeout(timer);
      }
    };

    return requestBridgeJson;
  };
})();
