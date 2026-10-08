import { createHash } from "node:crypto";

export const sha256 = (content) => createHash("sha256").update(content).digest("hex");

export const hashJson = (value) => sha256(JSON.stringify(value));
