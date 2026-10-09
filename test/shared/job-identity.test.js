import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { jobUrlContract, jobAnalysisContract } from "../../shared/contracts.js";
import { normalizeJobUrl } from "../../bridge/job-url.js";
import { runScriptsInVm } from "../../test-support/extension-scripts.js";

test("bridge and content adapters use the same identity while keeping their URL boundaries", async () => {
  const location = new URL("https://uk.indeed.com/jobs");
  const context = vm.createContext({ URL, location, window: { location } });
  await runScriptsInVm(context, ["contracts/job-urls.js", "extension-context.js", "job-url.js"]);
  const fromPage = context.jobSearchCompanion.jobs.jobUrlFromPageUrl;
  for (const [url, platform, id] of [
    ["https://uk.indeed.com/viewjob?vjk=fixture111&from=search", "indeed", "fixture111"],
    ["https://www.linkedin.com/jobs/view/4447780789/?trackingId=test", "linkedin", "4447780789"],
  ]) {
    assert.deepEqual(jobUrlContract.identityFromUrl(new URL(url)), { platform, id });
    assert.equal(fromPage(url), normalizeJobUrl(url));
    assert.equal(jobAnalysisContract.keyFor(url), `analyzed-job:${platform}:${id}`);
  }
  const selected = "https://www.indeed.com/jobs?vjk=fixture111";
  assert.equal(fromPage(selected), "https://www.indeed.com/viewjob?jk=fixture111");
  assert.equal(jobAnalysisContract.keyFor(selected), "analyzed-job:indeed:fixture111");
  assert.throws(() => normalizeJobUrl(selected), /Only Indeed and LinkedIn/);
  for (const url of [
    "https://indeed.com.attacker.test/viewjob?jk=fixture111",
    "https://notlinkedin.com/jobs/view/4447780789/",
    "https://uk.indeed.com/viewjob?jk=short",
    "https://www.linkedin.com/jobs/view/123/",
    "ftp://uk.indeed.com/viewjob?jk=fixture111",
  ]) {
    assert.equal(jobUrlContract.identityFromUrl(new URL(url)), null);
    assert.equal(fromPage(url), null);
    assert.throws(() => jobAnalysisContract.keyFor(url));
    assert.throws(() => normalizeJobUrl(url));
  }
});
