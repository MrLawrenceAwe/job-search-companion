// Delivery preferences shared by the card, settings page and service worker.
(() => {
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.recommendationPreferences = Object.freeze({
    enabledKey: "indeed-recommendations-enabled",
  });
})();
