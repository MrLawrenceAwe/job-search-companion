(() => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.identifiers = Object.freeze({
    isUuid: (value) => typeof value === "string" && uuidPattern.test(value),
  });
})();
