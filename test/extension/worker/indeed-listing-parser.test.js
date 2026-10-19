import assert from "node:assert/strict";
import test from "node:test";
import "../../../extension/worker/indeed-listing-parser.js";

const { parseIndeedListing } = globalThis.jobSearchWorkerModules;

test("listing fields are independent when only one can be established", () => {
  assert.deepEqual(parseIndeedListing('<h3>This job has expired on Indeed</h3>'), {
    title: null, availability: "expired",
  });
  assert.deepEqual(parseIndeedListing('<title>Support Advisor - London - Indeed.com</title>'), {
    title: "Support Advisor", availability: null,
  });
});

test("malformed and unrelated JSON-LD cannot become listing metadata", () => {
  assert.deepEqual(parseIndeedListing('<script type="application/ld+json">broken</script><script type="application/ld+json">{"@type":"WebSite","title":"Indeed"}</script>'), {
    title: null, availability: null,
  });
});
