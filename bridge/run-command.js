import { spawn } from "node:child_process";

export const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKillTimer = null;
    const timeoutMs = options.timeoutMs ?? 8000;
    const killGraceMs = options.killGraceMs ?? 500;
    const clearTimers = () => {
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, killGraceMs);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimers();
      reject(timedOut ? new Error(`${command} timed out`) : error);
    });
    child.on("close", (code) => {
      clearTimers();
      if (timedOut) {
        reject(new Error(`${command} timed out`));
        return;
      }
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
