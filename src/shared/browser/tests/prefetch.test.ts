import { test } from "node:test";
import assert from "node:assert/strict";
import { allowsPrefetch } from "../network.ts";

test("Neighbouring readings are prefetched unless the connection is slow or saving data", () => {
  assert.equal(allowsPrefetch(undefined), true);
  assert.equal(allowsPrefetch({}), true);
  assert.equal(allowsPrefetch({ effectiveType: "4g" }), true);
  assert.equal(allowsPrefetch({ saveData: false }), true);
  for (const effectiveType of ["slow-2g", "2g", "3g"])
    assert.equal(allowsPrefetch({ effectiveType }), false, effectiveType);
  assert.equal(allowsPrefetch({ saveData: true }), false);
  assert.equal(allowsPrefetch({ saveData: true, effectiveType: "4g" }), false);
});
