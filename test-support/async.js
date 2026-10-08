import assert from "node:assert/strict";

export const drainEventLoopUntil = async (condition, attempts = 30) => {
  for (let attempt = 0; attempt < attempts && !condition(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

export const waitUntil = async (
  condition,
  { attempts = 120, intervalMs = 5, message = "Expected state did not arrive" } = {},
) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  assert.ok(condition(), message);
};
