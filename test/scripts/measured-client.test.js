import assert from "node:assert/strict";
import test from "node:test";
import { createMeasuredClient } from "../../scripts/evaluations/measured-client.js";

test("measurement counts split UTF-8 output events while preserving the inference stream", async () => {
  const text = 'data: {"type":"response.output_text.delta","delta":"£test"}\n\n'
    + 'data: {"type":"response.completed","response":{"status":"completed"}}\n\n';
  const bytes = new TextEncoder().encode(text);
  const client = createMeasuredClient({
    async request() {
      return new Response(new ReadableStream({
        start(controller) {
          // One-byte chunks split both event delimiters and the multi-byte pound sign.
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }));
    },
  });
  assert.equal(await (await client.request("responses", {})).text(), text);
  assert.deepEqual(client.metrics, { requestCount: 1, outputBytes: Buffer.byteLength("£test") });
});
