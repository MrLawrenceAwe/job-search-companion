import { ChatGPTError } from "./chatgpt-accounts.js";

// Read through terminal SSE events; output deltas alone are never a successful response.
export const readCompletedJsonResponse = async (response) => {
  if (!response.body) throw new Error("ChatGPT returned no response stream");
  let buffer = "";
  let terminal = null;
  let bytes = 0;
  const completedItems = new Map();
  const consume = (block) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (
      event.type === "error" ||
      event.type === "response.failed" ||
      event.type === "response.incomplete"
    ) {
      const error = event.response?.error || event.error || event;
      throw new ChatGPTError(
        error.code === "subscription_sharing_usage_limit_exceeded"
          ? "ChatGPT plan usage limit reached. Manage usage, then resume checks."
          : "ChatGPT did not complete the response. Retry or check settings.",
        error.code || event.type,
        error.code === "subscription_sharing_usage_limit_exceeded" ? 429 : 503,
      );
    }
    if (event.type === "response.completed") terminal = event.response;
    // Plan-usage streams deliver output in item events; the completion envelope can have an empty output array.
    if (event.type === "response.output_item.done") {
      if (
        !Number.isInteger(event.output_index) ||
        event.output_index < 0 ||
        event.output_index > 100
      )
        throw new Error("Invalid ChatGPT output index");
      completedItems.set(event.output_index, event.item);
    }
  };
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 2_000_000) throw new Error("ChatGPT response exceeded its size limit");
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      consume(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (!terminal || terminal.status !== "completed")
    throw new Error("ChatGPT stream ended before completion");
  const output = terminal.output?.length
    ? terminal.output
    : [...completedItems.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
  const text = output
    .filter((item) => item?.type === "message" && item.role === "assistant")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("");
  if (!text) throw new Error("ChatGPT completed without JSON output");
  return JSON.parse(text);
};

