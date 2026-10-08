export const flushUntil = async (condition, attempts = 30) => {
  for (let attempt = 0; attempt < attempts && !condition(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
