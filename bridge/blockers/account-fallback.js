const describeFailure = (error) => {
  if (error.code === "subscription_sharing_usage_limit_exceeded") return "plan usage limit reached";
  if (error.status === 401) return "authentication failed; reconnect this account";
  if (error.status === 403) return "access denied";
  if (error.status === 429) return "temporarily rate limited";
  if (error.code === "subscription_sharing_unsupported_capability") return "model capability unsupported";
  return Number.isInteger(error.status) ? `request failed (HTTP ${error.status})` : "connection or request failed";
};

// One invocation retains its candidate list and diagnostics across indexing and checking.
export const runWithAccountFallback = async ({
  chatgpt,
  run,
  getRequiredModel,
  checkJob,
  isCurrent,
  isFallbackEnabled,
}) => {
  let candidates = null;
  const failures = [];
  const accounts = chatgpt.connectionStatus().accounts || [];
  const labels = new Map(accounts.map((account, index) => [account.id, account.label || `Account ${index + 1}`]));
  const recordFailure = (accountId, stage, reason) => {
    if (!labels.has(accountId)) labels.set(accountId, `Account ${labels.size + 1}`);
    failures.push(`${labels.get(accountId)} (${stage}, ${getRequiredModel()}): ${reason}`);
  };
  const withDiagnostics = (error, summary) => {
    error.message = `${summary} Account attempts: ${failures.join(". ")}.`;
    return error;
  };
  while (true) {
    try {
      return await run();
    } catch (error) {
      if (!isCurrent() || !isFallbackEnabled())
        throw error;
      if (error.code !== "subscription_sharing_usage_limit_exceeded") {
        if (failures.length) {
          recordFailure(checkJob.accountId, "request", describeFailure(error));
          withDiagnostics(error, "ChatGPT fallback request failed.");
        }
        throw error;
      }
      recordFailure(checkJob.accountId, "request", describeFailure(error));
      candidates ??= chatgpt.fallbackAccountIds();
      let available = false;
      let accountId;
      let stage;
      try {
        while (candidates.length && isCurrent()) {
          accountId = candidates.shift();
          stage = "account selection";
          await chatgpt.select(accountId);
          checkJob.accountId = accountId;
          if (!isCurrent()) throw error;
          let models;
          stage = "model lookup";
          try {
            models = await chatgpt.models();
          } catch (catalogError) {
            if (
              isCurrent() &&
              ([401, 403].includes(catalogError.status) ||
                catalogError.code === "subscription_sharing_usage_limit_exceeded")
            ) {
              recordFailure(accountId, stage, describeFailure(catalogError));
              continue;
            }
            throw catalogError;
          }
          if (!isCurrent()) throw error;
          if (models.some((availableModel) => availableModel.slug === getRequiredModel())) {
            available = true;
            break;
          }
          recordFailure(accountId, stage, "required model unavailable");
        }
        if (!available) {
          throw error;
        }
      } catch (fallbackError) {
        if (isCurrent()) {
          if (fallbackError !== error) recordFailure(accountId, stage, describeFailure(fallbackError));
          withDiagnostics(fallbackError, fallbackError === error
            ? "ChatGPT usage limit reached. No connected fallback account can continue with this model. Manage usage or connect another account, then resume checks."
            : "ChatGPT account fallback failed. Check the connection and settings, then resume checks.");
        }
        fallbackError.pauseChecks = true;
        throw fallbackError;
      }
    }
  }
};
