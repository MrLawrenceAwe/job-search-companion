# Blocker-checker evaluations

Run from the repository root:

```sh
node scripts/evaluations/benchmark-blockers.js
node scripts/evaluations/verify-cv-blockers.js medium gpt-6-sol
node scripts/evaluations/compare-blocker-checks.js <baseline-git-ref>
node scripts/evaluations/compare-blocker-checks.js <baseline-git-ref> low
node scripts/evaluations/benchmark-cv-preparation.js <baseline-git-ref>
```

The inference comparison, benchmark and verification commands consume ChatGPT plan usage through the active account and require a fresh
token. They never refresh credentials or change checker settings. Verification
may refresh the private CV index; benchmarking uses profile facts without indexing.
`benchmark-cv-preparation.js` uses real CV reads/converters with a mocked index
response, temporary stores and no network requests or ChatGPT plan usage. It
alternates baseline/current order for three pairs, measures cold preparation and
unchanged-index reuse, and requires identical complete passage inputs across runs.
Cold means a fresh extraction/index cache; operating-system caches are not flushed.

## Retained evidence

| Report | Purpose |
| --- | --- |
| [CV preparation](2026-10-12T09-30-19-436Z-cv-preparation-performance.json) | Local serial versus bounded concurrent CV preparation, without model latency |
| [Omitted-fields experiment](2026-10-12T09-37-35-735Z-blocker-check-performance.json) | Reverted experiment omitting non-finding explanations and missing-evidence fact-ID lists |
| [Light comparison](2026-10-12T09-41-22-492Z-blocker-check-performance.json) | Version 10 Medium versus Light with identical prompts and frozen CV evidence |
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

The CV preparation comparison covered 65 source files and 224 passages in each of
three matched pairs. Median cold preparation fell from 2.932 to 1.171 seconds
(60.1% lower); unchanged-index reuse measured 6.38 versus 4.90 milliseconds.
The complete evidence input was identical across all runs. These measurements
exclude model/network latency and do not measure complete blocker-check speed.

The omitted-fields experiment retained the full inventory and evidence validation
at Luna Medium. All twelve experimental checks passed, while the baseline had one
validation error. Across eleven completed pairs, median completion increased from
5.812 to 6.299 seconds (8.4% slower), despite median JSON output decreasing from
602 to 555 bytes. The candidate was reverted because this run did not demonstrate
a latency benefit. The report's `current` variant means that experimental schema,
not the retained checker; its prompt/schema hashes identify the tested candidate.

The subsequent Light comparison used the retained version 10 schema and identical
prompts/evidence. Each effort had eleven passing checks and one validation error;
ten pairs completed on both sides. Matched median completion was 4.341 seconds
at Medium and 4.838 seconds at Light (11.4% slower). This small, variable sample
does not establish that Light is intrinsically slower, but it provides no basis
for switching defaults or saved settings. Medium remains the default. Neither
inference experiment demonstrated a reliable speed improvement.

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

`scripts/evaluations/cases.js` owns the shared advert fixtures. Case names include
a version; distinct advert variants have distinct names even when they test the
same requirement. Change the name or version when changing advert text. New
reports use these identities; retained historical reports keep their original names
and inputs. Benchmark cases retain their longer weekday/remote wording, while CV
verification retains its separate remote qualification variant.

`compare-blocker-checks.js` holds the model at Luna, alternates request order,
and runs six cases twice with one profile and frozen saved CV index. Baseline
reasoning is Medium; current reasoning defaults to Medium and accepts `low` as
the second argument. Each new run records its effort, and reports record both
baseline/current efforts. Use an explicit baseline ref after committing changes. Baseline modules and their
relative dependencies are loaded from a temporary snapshot of that revision,
removed after the comparison. Historical inference inputs are passed only to
the baseline; current checks use the evidence contract.
Account/access failures stop remaining requests. Accuracy checks compare finding
presence and required specialist quotes across revisions, while reports retain
each revision’s raw outcome labels. This keeps result-name changes separate from
classification changes. Statistics share the median calculation and completed-pair
selection used by the other evaluation commands.

New reports use exclusive UTC timestamp filenames and record versions, prompt/schema
hashes, evidence identity, request counts, JSON bytes, outcomes and paired latency.
Compare only matched completed pairs; report request errors and accuracy separately.
Low requires at least a 20% improvement and every outcome passing. New benchmark
summaries call this decision rule `minimumImprovementPercent`; it is not a statistical
significance test. With no completed pairs, medians and improvement are null.
Historical reports retain their original field names and metadata and must not be
treated as equivalent experiments across prompt versions.
