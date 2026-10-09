import { randomBytes, timingSafeEqual } from "node:crypto";
import { assertNoSymbolicLinkPaths, atomicWrite, readOptionalFile } from "../shared/filesystem.js";
import { jobAnalysisContract, identifierContract } from "../shared/contracts.js";
import { sha256 } from "../shared/sha256.js";

export const openAnalysisStore = async (path) => {
  await assertNoSymbolicLinkPaths([path]);
  const contents = await readOptionalFile(path);
  const state = contents === null ? { version: 1, requests: [] } : JSON.parse(contents);
  if (state.version !== 1 || !Array.isArray(state.requests) || state.requests.some((record) =>
    !identifierContract.isUuid(record.id) || typeof record.tokenHash !== "string"
    || !/^[a-f0-9]{64}$/.test(record.tokenHash) || typeof record.jobUrl !== "string"
    || (record.threadId !== undefined && !jobAnalysisContract.isRecord(record)))) {
    throw new Error(`Invalid analysis state: ${path}`);
  }
  let requests = new Map(state.requests.map((record) => [record.id, record]));
  let queue = Promise.resolve();
  const transaction = (mutate) => {
    const result = queue.then(async () => {
      const next = new Map(requests);
      const value = mutate(next);
      await atomicWrite(path, `${JSON.stringify({ version: 1, requests: [...next.values()] }, null, 2)}\n`, 0o600);
      requests = next;
      return value;
    });
    queue = result.catch(() => {});
    return result;
  };
  return {
    create: ({ id, jobUrl }) => {
      if (!identifierContract.isUuid(id)) throw new Error("Invalid analysis ID");
      jobAnalysisContract.keyFor(jobUrl);
      const token = randomBytes(32).toString("hex");
      return transaction((next) => {
        if (next.has(id)) throw new Error("Analysis ID already exists");
        next.set(id, { id, jobUrl, tokenHash: sha256(token) });
        return { id, token };
      });
    },
    complete: ({ id, token, threadId, verdict }) => transaction((next) => {
      const request = next.get(id);
      if (!request || typeof token !== "string" || token.length > 128
        || !timingSafeEqual(Buffer.from(request.tokenHash, "hex"), Buffer.from(sha256(token), "hex"))) {
        throw new Error("Invalid analysis completion token");
      }
      if (!identifierContract.isUuid(threadId)) throw new Error("Invalid Codex chat ID");
      if (!jobAnalysisContract.isVerdict(verdict)) throw new Error("Invalid CV-fit verdict");
      if (request.threadId && request.threadId !== threadId) throw new Error("Analysis already completed for another chat");
      if (request.verdict && request.verdict !== verdict) throw new Error("Analysis already completed with another verdict");
      const completed = request.threadId ? { ...request, verdict }
        : { ...request, threadId, verdict, analyzedAt: new Date().toISOString() };
      next.set(id, completed);
      return { jobUrl: completed.jobUrl, threadId: completed.threadId, analyzedAt: completed.analyzedAt, verdict: completed.verdict };
    }),
    list: () => {
      const latest = new Map();
      for (const record of requests.values()) {
        if (!record.threadId) continue;
        const key = jobAnalysisContract.keyFor(record.jobUrl);
        const prior = latest.get(key);
        if (!prior || record.analyzedAt > prior.analyzedAt) latest.set(key, {
          jobUrl: record.jobUrl, threadId: record.threadId, analyzedAt: record.analyzedAt,
          ...(record.verdict === undefined ? {} : { verdict: record.verdict }),
        });
      }
      return [...latest.values()];
    },
  };
};
