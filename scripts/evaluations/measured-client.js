// Observe output deltas while passing every stream chunk through to inference.
export const createMeasuredClient = (client) => {
  const metrics = { requestCount: 0, outputBytes: 0 };
  return {
    metrics,
    async request(endpoint, options) {
      metrics.requestCount += 1;
      const response = await client.request(endpoint, options);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const countOutput = (block) => {
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice(5));
            if (event.type === "response.output_text.delta") {
              metrics.outputBytes += Buffer.byteLength(event.delta || "");
            }
          } catch { /* Non-JSON events do not contribute output bytes. */ }
        }
      };
      const body = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            countOutput(buffer.slice(0, end));
            buffer = buffer.slice(end + 2);
          }
          controller.enqueue(value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    },
  };
};
