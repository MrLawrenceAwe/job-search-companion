// One invocation retains its candidate list, trying each distinct subscriber once.
export const inferWithAccountFallback = async ({
  chatgpt,
  infer,
  checkJob,
  signal,
  isCurrent,
  enabled,
}) => {
  let candidates = null;
  while (true) {
    try {
      return await infer({
        chatgpt,
        model: checkJob.model,
        description: checkJob.description,
        profile: checkJob.profile,
        signal,
      });
    } catch (error) {
      if (!isCurrent() || !enabled() || error.code !== "subscription_sharing_usage_limit_exceeded")
        throw error;
      candidates ??= chatgpt.fallbackAccountIds();
      let available = false;
      try {
        while (candidates.length && isCurrent()) {
          const accountId = candidates.shift();
          await chatgpt.select(accountId);
          checkJob.accountId = accountId;
          if (!isCurrent()) throw error;
          let models;
          try {
            models = await chatgpt.models();
          } catch (catalogError) {
            if (
              isCurrent() &&
              ([401, 403].includes(catalogError.status) ||
                catalogError.code === "subscription_sharing_usage_limit_exceeded")
            )
              continue;
            throw catalogError;
          }
          if (!isCurrent()) throw error;
          if (models.some((model) => model.slug === checkJob.model)) {
            available = true;
            break;
          }
        }
        if (!available) {
          error.message =
            "ChatGPT usage limit reached. No connected fallback account can continue with this model. Manage usage or connect another account, then resume checks.";
          throw error;
        }
      } catch (fallbackError) {
        fallbackError.pauseChecks = true;
        throw fallbackError;
      }
    }
  }
};
