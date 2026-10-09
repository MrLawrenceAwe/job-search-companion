// Chrome loads these files as classic scripts; Node imports the same definitions.
import "../extension/contracts/blockers.js";
import "../extension/contracts/job-urls.js";
import "../extension/contracts/cv-fit-submissions.js";
import "../extension/contracts/identifiers.js";
import "../extension/contracts/job-analyses.js";

export const {
  identifiers: identifierContract,
  blockers: blockerContract,
  jobUrls: jobUrlContract,
  cvFitSubmissions: cvFitSubmissionContract,
  jobAnalyses: jobAnalysisContract,
} = globalThis.jobSearchContracts;
