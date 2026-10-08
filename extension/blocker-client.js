(() => {
  const { blockerRequest } = globalThis.jobSearchContracts.messages;
  globalThis.jobSearchBlockerClient = Object.freeze({
    async request(action, body, id) {
      const response = await chrome.runtime.sendMessage({
        type: blockerRequest,
        action,
        body,
        id,
      });
      if (!response?.ok) throw new Error(response?.error || "Local checker unavailable");
      return response;
    },
  });
})();
