import { test } from "node:test";
import assert from "node:assert/strict";
import { comparePosition, COMPARE_MIN_SAMPLE } from "./compare.ts";

test("one competitor is not a verdict", () => {
  const r = comparePosition([38.99], 35);
  assert.equal(r.position, "unknown");
  assert.equal(r.median, 38.99);
  assert.match(r.note ?? "", /Only 1 listing with a visible price/);
  assert.match(r.note ?? "", new RegExp(`needs ${COMPARE_MIN_SAMPLE}`));
});

test("three priced listings give a position against the median", () => {
  const below = comparePosition([38, 40, 44], 35);
  assert.equal(below.position, "below_market");
  assert.equal(below.median, 40);
  assert.match(below.note ?? "", /13% below the median of 40.00 across 3 listings/);
  assert.equal(comparePosition([38, 40, 44, 50], 41).position, "at_market");
  assert.equal(comparePosition([30, 31, 32], 40).position, "above_market");
});

test("no prices or no own price stays unknown with a plain note", () => {
  assert.equal(comparePosition([], 20).position, "unknown");
  const r = comparePosition([10, 12, 14], null);
  assert.equal(r.position, "unknown");
  assert.equal(r.median, 12);
});
