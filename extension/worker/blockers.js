(() => {
  globalThis.jobSearchWorkerModules ??= {};
  globalThis.jobSearchWorkerModules.createBlockerHandler = ({ bridgeConfig, requestBridgeJson, isJobSiteSender }) => {
    const messages = globalThis.jobSearchContracts.messages;
    const BLOCKER_ACTIONS = new Map([
      ["status", ["GET", "/status"]],
      ["models", ["GET", "/models"]],
      ["settings", ["POST", "/settings"]],
      ["sign-in", ["POST", "/sign-in"]],
      ["cancel-sign-in", ["POST", "/cancel-sign-in"]],
      ["account", ["POST", "/account"]],
      ["sign-out", ["POST", "/sign-out"]],
      ["clear-cache", ["POST", "/clear-cache"]],
      ["check", ["POST", "/checks"]],
      ["poll", ["GET", "/checks/"]],
    ]);
    const handleBlockerMessage = (message, sender, sendResponse) => {
      if (message?.type !== messages.blockerRequest) return false;
      const action = BLOCKER_ACTIONS.get(message.action);
      const isSettings = sender.url === chrome.runtime.getURL("options.html");
      if (
        !action ||
        (!isSettings &&
          (!isJobSiteSender(sender, ["indeed"]) || !["status", "check", "poll"].includes(message.action)))
      ) {
        sendResponse({ ok: false, error: "Blocker request is not allowed" });
        return false;
      }
      if (!bridgeConfig.bridgeToken || !bridgeConfig.bridgeOrigin) {
        sendResponse({
          ok: false,
          error: "Install the local bridge to enable blocker checks.",
        });
        return false;
      }
      if (message.action === "poll" && !globalThis.jobSearchContracts.identifiers.isUuid(message.id)) {
        sendResponse({ ok: false, error: "Invalid check ID" });
        return false;
      }
      const [method, path] = action;
      requestBridgeJson(
        `${bridgeConfig.bridgeOrigin}/blockers${path}${message.action === "poll" ? message.id : ""}`,
        { method, body: message.body || {} },
      )
        .then(({ body, parseError }) => {
          if (parseError) throw parseError;
          // Only the extension settings page may receive sign-in URLs or account state.
          if (!isSettings && body.connectionStatus) {
            body.connectionStatus = { planUsageEnabled: body.connectionStatus.planUsageEnabled };
            if (body.evidence) body.evidence = { hash: body.evidence.hash };
          }
          sendResponse(body);
        })
        .catch((error) =>
          sendResponse({
            ok: false,
            error:
              error.name === "AbortError"
                ? "Local checker did not respond. Try again."
                : "Local checker unavailable. Check that the bridge is running.",
          }),
        );
      return true;
    };

    return handleBlockerMessage;
  };
})();
