# Blocker-checker evaluations

Run from the repository root:

```sh
node scripts/evaluations/benchmark-blockers.js
node scripts/evaluations/verify-cv-blockers.js medium gpt-6-sol
node scripts/evaluations/compare-blocker-checks.js <baseline-git-ref>
```

Commands consume ChatGPT plan usage through the active account and require a fresh
token. They never refresh credentials or change checker settings. Verification
may refresh the private CV index; benchmarking uses profile facts without indexing.

## Retained evidence

| Report | Purpose |
| --- | --- |
| [Final comparison](2026-10-10T07-58-46-252Z-blocker-check-performance.json) | Checker version 9 before/after comparison with frozen CV evidence |
| [Schema regression](2026-10-10T07-55-29-959Z-blocker-benchmark.json) | Failure that motivated disjoint nullable-explanation schema branches |
| [Initial benchmark](2026-10-09-blocker-benchmark.json) | Earlier low/medium comparison; a different prompt/evidence generation |
| [Sol-index verification](2026-10-09-cv-blocker-verification-sol-index-medium.json) | Three CV-evidence regression outcomes with a Sol-built index |

The final comparison ran six cases twice at Luna Medium. All twelve current checks
passed expected outcomes without request or validation errors; the baseline passed
eleven with one validation error. Eleven matched pairs had median completion times
of 5.046 seconds before and 3.952 seconds after (21.7% lower), with median JSON
output decreasing from 1,246 to 759 bytes. This small sample is not a comprehensive
accuracy audit or a guarantee of latency improvement on every advert; indexing
was not run.

The preceding schema regression had nine validation failures in twelve requests:
null explanations were allowed for actual findings. The corrected schema requires
prose for unsupported mandatory/uncertain requirements and null for supported,
preferred and excluded entries. The prompt retains specialist guidance and the
complete requirement inventory.

Earlier reports have different prompts and evidence. The initial low/medium run
did not justify switching to Low; the Sol-index run passed the renewables,
degree/testing and driving regressions. These are limited historical observations.

Six superseded exploratory reports were removed from the current checkout. Their
original bytes and the longer experiment narrative remain in
[the review baseline](https://github.com/MrLawrenceAwe/job-search-companion/tree/25ed9f0338e2741258ebbcaeb6d84efa7d75c2f6/docs/evaluations).

The benchmark-summary regression retains only the twelve original run records
needed for its statistics in `test-support/benchmark-usage-limit-runs.json`, with
a source permalink. It does not depend on keeping the full exploratory report.

## Reproduction and new reports

`compare-blocker-checks.js` holds the model at Luna Medium, alternates request order,
and runs six cases twice with one profile and frozen saved CV index. Use an explicit
baseline ref after committing changes. Account/access failures stop remaining requests.

New reports use exclusive UTC timestamp filenames and record versions, prompt/schema
hashes, evidence identity, request counts, JSON bytes, outcomes and paired latency.
Compare only matched completed pairs; report request errors and accuracy separately.
Low requires at least a 20% improvement and every outcome passing. With no completed
pairs, medians and improvement are null. Historical reports retain their original
metadata and must not be treated as equivalent experiments across prompt versions.
