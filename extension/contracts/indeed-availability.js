(() => {
  const freshnessMs = 3_600_000;
  const isStatus = (status) => ["active", "expired"].includes(status);
  const isRecord = (record) => isStatus(record?.status) && Number.isFinite(Date.parse(record.checkedAt));
  globalThis.jobSearchContracts ??= {};
  globalThis.jobSearchContracts.indeedAvailability = Object.freeze({
    freshnessMs,
    isStatus,
    isRecord,
    isFresh: (record, now = Date.now()) => isRecord(record) && now - Date.parse(record.checkedAt) < freshnessMs,
  });
})();
