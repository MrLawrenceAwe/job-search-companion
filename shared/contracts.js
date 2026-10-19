// Chrome loads these files as classic scripts; Node imports the same definitions.
import "../extension/contracts/blockers.js";
import "../extension/contracts/inference-settings.js";
import "../extension/contracts/job-urls.js";
import "../extension/contracts/job-storage-keys.js";
import "../extension/contracts/cv-fit-submissions.js";
import "../extension/contracts/cv-fit-settings.js";
import "../extension/contracts/identifiers.js";
import "../extension/contracts/job-analyses.js";

export const {
  identifiers: identifierContract,
  blockers: blockerContract,
  inferenceSettings: inferenceSettingsContract,
  jobUrls: jobUrlContract,
  jobStorageKeys: jobStorageKeyContract,
  cvFitSubmissions: cvFitSubmissionContract,
  cvFitSettings,
  jobAnalyses: jobAnalysisContract,
} = globalThis.jobSearchContracts;
