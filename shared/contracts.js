// Chrome loads these files as classic scripts; Node imports the same definitions.
import "../extension/contracts/blockers.js";
import "../extension/contracts/job-urls.js";

export const { blockers: blockerContract, jobUrls: jobUrlContract } = globalThis.jobSearchContracts;
