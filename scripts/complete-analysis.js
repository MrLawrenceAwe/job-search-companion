import { bridgeAddress } from "../bridge/address.js";
import { jobAnalysisContract } from "../shared/contracts.js";

// This callback has authority over one analysis only; it never reads the bridge token.
const [id, token, verdict] = process.argv.slice(2);
try {
  const threadId = process.env.CODEX_THREAD_ID;
  if (!jobAnalysisContract.isThreadId(id) || !jobAnalysisContract.isThreadId(threadId)
    || !/^[a-f0-9]{64}$/.test(token || "")) throw new Error("Missing valid analysis context or CODEX_THREAD_ID");
  if (!jobAnalysisContract.isVerdict(verdict)) throw new Error("A valid CV-fit verdict is required");
  const response = await fetch(`${bridgeAddress.origin}/analyses/${id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-JSC-Analysis-Token": token },
    body: JSON.stringify({ threadId, verdict }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Analysis callback failed");
  console.log("Job marked as analysed. Open analysis: " + jobAnalysisContract.linkFor(threadId));
} catch (error) {
  console.error("Could not record the completed analysis: " + error.message);
  process.exitCode = 1;
}
