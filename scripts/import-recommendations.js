import { saveRecommendations } from "../bridge/recommendations.js";

// Local, bounded stdin only. No browser access, credentials, or network requests.
try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 500_000) throw new Error("Feed input is too large");
  }
  const batch = await saveRecommendations(JSON.parse(input));
  console.log(JSON.stringify({ ok: true, status: batch.status, count: batch.jobs.length }));
} catch {
  // Malformed or failed collection invalidates the old batch instead of resurfacing it.
  await saveRecommendations({ status: "unavailable" }).catch(() => {});
  console.error("Recommendations were not imported.");
  process.exitCode = 1;
}
