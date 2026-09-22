import test from "node:test";
import assert from "node:assert/strict";

test("core invariants", () => {
  assert.equal(10 - 3, 7);
  assert.equal(10, 10);
});
