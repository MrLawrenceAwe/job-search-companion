import {
  appendFileSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const assertPrivateLogPath = (path) => {
  const absolutePath = resolve(path);
  const components = [];
  for (let component = absolutePath; ; component = dirname(component)) {
    components.push(component);
    if (dirname(component) === component) {
      break;
    }
  }
  for (const component of components.reverse()) {
    try {
      if (lstatSync(component).isSymbolicLink()) {
        throw new Error(`Log path may not contain symbolic links: ${component}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
};

const formatPart = (part) => {
  if (part instanceof Error) {
    return part.stack || part.message;
  }
  return typeof part === "string" ? part : JSON.stringify(part);
};

export const createFileLogger = (
  logPath,
  {
    maximumBytes = 1_000_000,
    retainedFiles = 3,
  } = {},
) => {
  assertPrivateLogPath(logPath);
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });

  const rotateIfNeeded = (incomingBytes) => {
    const currentBytes = statSync(logPath, { throwIfNoEntry: false })?.size ?? 0;
    if (currentBytes + incomingBytes <= maximumBytes) {
      return;
    }
    rmSync(`${logPath}.${retainedFiles}`, { force: true });
    for (let index = retainedFiles - 1; index >= 1; index -= 1) {
      try {
        renameSync(`${logPath}.${index}`, `${logPath}.${index + 1}`);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    try {
      renameSync(logPath, `${logPath}.1`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  };

  const write = (level, parts) => {
    const line = `${new Date().toISOString()} ${level} ${parts.map(formatPart).join(" ")}\n`;
    rotateIfNeeded(Buffer.byteLength(line));
    assertPrivateLogPath(logPath);
    appendFileSync(logPath, line, { encoding: "utf8", mode: 0o600, flag: "a" });
    chmodSync(logPath, 0o600);
  };

  const writeSafely = (level, parts) => {
    try {
      write(level, parts);
    } catch {
      // Runtime logging is best-effort and must not affect bridge behavior.
    }
  };

  return Object.freeze({
    info: (...parts) => writeSafely("INFO", parts),
    warn: (...parts) => writeSafely("WARN", parts),
    error: (...parts) => writeSafely("ERROR", parts),
  });
};
