# Blocker-checker evaluations

Run from the repository root:

```sh
node scripts/evaluations/benchmark-blockers.js
node scripts/evaluations/verify-cv-blockers.js medium gpt-6-sol
```

Both commands use the active connected account, require a fresh token, and consume
ChatGPT plan usage. They never refresh credentials or change checker preferences.
Verification may refresh the private CV evidence index. Benchmarking uses profile
facts without CV indexing; verification covers the indexed-evidence path.

New reports use UTC timestamps and exclusive file creation. They include the checker
and CV-index versions and both prompt hashes; existing reports are never overwritten.
The historical reports below predate that metadata and retain their original contents.
Do not compare measurements across prompt versions as if they were the same experiment.

Benchmark latency medians use only case/round pairs where both Light and Medium
completed without a request error. Completed responses with incorrect outcomes
still count toward latency, with accuracy failures reported separately. Reports
include completed/excluded pair counts and per-effort request-error and incorrect-outcome
counts. With no completed pairs, medians and improvement are `null`. Light is
recommended only with at least a 20% improvement and every outcome passing.

Historical reports retain their original statistics. The 10:50 run included four
usage-limit errors in its reported medians; recalculating from matched completed
pairs yields 5.176 seconds for Light and 5.262 seconds for Medium (1.6% improvement,
rather than the recorded 20.3%). Its accuracy failure still rules out recommending Light.

## Cleanup verification

The reduced prompt passed the three CV regression cases, but broader benchmarking
exposed inaccurate requirements inferred from future duties. The final prompt keeps
the original specialist guidance and removes only a repeated sentence. These
experiments are retained in the dated reports for traceability. A fresh live check
of the final prompt was blocked by the connected account's usage limit; the passing
reduced-prompt run does not validate the final prompt. Local automated tests pass.

## Historical observations

Before requirement inventory and CV indexing were added, on 9 October 2026, 12 live requests compared low and medium using the same verified profile, three sample descriptions and Fast processing. Two rounds alternated request order. Median completion time was **2.59 seconds for Light** and **2.44 seconds for Medium**: Light was 6.2% slower in this small sample, so no automatic switch was made. The switch threshold was a 20% reduction with all fixture outcomes passing. Low passed all six outcomes; medium passed five, missing the uncertain DBS requirement once in an advert containing an instruction injection. These synthetic cases are a limited check, not a comprehensive accuracy evaluation or a promise of future latency. Full inputs, timings and outcomes are in [the benchmark report](2026-10-09-blocker-benchmark.json).

### CV evidence regression verification

With a Sol-built CV index on 9 October 2026, the three live regression outcomes passed: renewables/compliance uncertainty, evidenced degree/ISTQB/manual testing, and mandatory driving. The index build took 24.2 seconds; Luna Medium checks took 10.4, 6.2 and 3.4 seconds respectively. These are single-run measurements. The separate low/medium comparison using a Luna-built index did not show a consistent Light speed advantage, so Medium was retained. See [the Sol index verification report](2026-10-09-cv-blocker-verification-sol-index-medium.json).
