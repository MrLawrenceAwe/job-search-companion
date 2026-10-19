(() => {
  globalThis.jobSearchWorkerModules ??= {};
  globalThis.jobSearchWorkerModules.isJobSiteSender = (sender, platforms) => {
    try {
      const url = new URL(sender.url);
      const { isIndeedHost, isLinkedInHost } = globalThis.jobSearchContracts.jobUrls;
      return url.protocol === "https:" && platforms.some((platform) =>
        platform === "indeed" ? isIndeedHost(url.hostname) : isLinkedInHost(url.hostname));
    } catch {
      return false;
    }
  };
})();
