import assert from "node:assert/strict";
import test from "node:test";
import { readCompletedJsonResponse } from "../../../bridge/blockers/chatgpt-response.js";

const sse = (...events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
const completed = (text) => ({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] } });

test("SSE completion requires the terminal event; limit failures after deltas remain failures", async () => {
  await assert.rejects(readCompletedJsonResponse(sse({ type: "response.output_text.delta", delta: '{"requirements":[]}' })), /before completion/);
  await assert.rejects(readCompletedJsonResponse(sse(completed('{"requirements":[]}'), { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } })), (error) => error.status === 429);
  assert.deepEqual(await readCompletedJsonResponse(sse(completed('{"requirements":[]}'))), { requirements: [] });
  await assert.rejects(readCompletedJsonResponse(sse(completed(""))), /without JSON output/);
});

test("plan-usage streams retain completed output items but require successful response completion", async () => {
  const item = { type: "response.output_item.done", output_index: 0, item: { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"requirements":[]}' }] } };
  const terminal = { type: "response.completed", response: { status: "completed", output: [] } };
  assert.deepEqual(await readCompletedJsonResponse(sse(item, terminal)), { requirements: [] });
  await assert.rejects(readCompletedJsonResponse(sse(item)), /before completion/);
  await assert.rejects(readCompletedJsonResponse(sse(item, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } })), (error) => error.status === 429);
});

