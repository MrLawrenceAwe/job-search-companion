import { bridgeAddress } from "../bridge/address.js";
import { identifierContract } from "../shared/contracts.js";

// This callback has authority over one analysis only; it never reads the bridge token.
const [id, token] = process.argv.slice(2);
try {
  const threadId = process.env.CODEX_THREAD_ID;
  if (!identifierContract.isUuid(id) || !identifierContract.isUuid(threadId)
    || !/^[a-f0-9]{64}$/.test(token || "")) throw new Error("Missing valid analysis context or CODEX_THREAD_ID");
  const response = await fetch(`${bridgeAddress.origin}/analyses/${id}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-JSC-Analysis-Token": token },
    body: JSON.stringify({ threadId }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Analysis callback failed");
  console.log("Job marked as analysing.");
} catch (error) {
  console.error("Could not record the analysis start: " + error.message);
  process.exitCode = 1;
}
