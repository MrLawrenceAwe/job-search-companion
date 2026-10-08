import { readFile } from "node:fs/promises";
import { bridgeAddress } from "../bridge/address.js";
import { helperContract } from "../bridge/codex/helper-contract.js";
import { cvFitSettings } from "../shared/cv-fit-settings.js";

const HEALTH_REQUEST_TIMEOUT_MS = 2_000;

const bridgeToken = process.env.JSC_BRIDGE_TOKEN;
if (!bridgeToken) {
  throw new Error("JSC_BRIDGE_TOKEN must be set");
}

const healthEndpoint = new URL("/health", bridgeAddress.origin);
const requestAbortController = new AbortController();
const requestTimeout = setTimeout(
  () => requestAbortController.abort(),
  HEALTH_REQUEST_TIMEOUT_MS,
);
const response = await fetch(healthEndpoint, {
  headers: {
    "X-JSC-Token": bridgeToken,
  },
  signal: requestAbortController.signal,
}).finally(() => clearTimeout(requestTimeout));
const body = await response.json();

const packageMetadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

const failures = [];
if (!response.ok || !body.ok) {
  failures.push(`unexpected HTTP status or ok flag: ${response.status}`);
}
if (body.service !== packageMetadata.name) {
  failures.push(`expected service ${packageMetadata.name}, got ${JSON.stringify(body.service)}`);
}
if (body.version !== packageMetadata.version) {
  failures.push(`expected version ${packageMetadata.version}, got ${JSON.stringify(body.version)}`);
}
if (body.port !== Number(healthEndpoint.port)) {
  failures.push(`expected port ${healthEndpoint.port}, got ${JSON.stringify(body.port)}`);
}
const expectedInstanceId = process.env.JSC_BRIDGE_INSTANCE_ID;
if (expectedInstanceId && body.instanceId !== expectedInstanceId) {
  failures.push(`expected bridge instance ${expectedInstanceId}, got ${JSON.stringify(body.instanceId)}`);
}
if (body.accessibilityHelper?.ready !== true
    || body.accessibilityHelper?.protocolVersion !== helperContract.protocolVersion
    || body.accessibilityHelper?.contractVersion !== helperContract.contractVersion
    || body.accessibilityHelper?.hashMatchesInstallState !== true) {
  failures.push(
    `expected a current managed Accessibility helper, got ${JSON.stringify(body.accessibilityHelper)}`,
  );
}
if (JSON.stringify(body.requiredSettings) !== JSON.stringify(
  cvFitSettings.map(({ category, label }) => ({ category, label })),
)) {
  failures.push(
    `expected required CV Fit settings, got ${JSON.stringify(body.requiredSettings)}`,
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(body);
  process.exit(1);
}

console.log(JSON.stringify(body, null, 2));
