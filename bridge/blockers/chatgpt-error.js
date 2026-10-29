export class ChatGPTError extends Error {
  constructor(message, code = "connection_error", status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
