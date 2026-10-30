import { test } from "node:test";
import assert from "node:assert/strict";
import { decideQuota, limitFor, pruneUsage, usageKey } from "./limits.ts";

test("limits read env overrides and fall back to defaults", () => {
  assert.equal(limitFor("checks", {}), 40);
  assert.equal(limitFor("checks", { SR_LIMIT_CHECKS: "100" }), 100);
  assert.equal(limitFor("ingests", { SR_LIMIT_INGESTS: "abc" }), 10);
  assert.equal(limitFor("compares", { SR_LIMIT_COMPARES: "0" }), 0);
});

test("quota decisions", () => {
  assert.equal(decideQuota("checks", 39, 40).allowed, true);
  const d = decideQuota("checks", 40, 40);
  assert.equal(d.allowed, false);
  assert.match(d.message ?? "", /Daily limit reached: 40 rule checks/);
  assert.equal(decideQuota("checks", 35, 40, 8).allowed, false, "a multi-rule check counts its rules");
  assert.equal(decideQuota("compares", 1000, 0).allowed, true, "0 disables the cap");
});

test("usage keys are per day and old days are pruned", () => {
  const d = new Date("2026-10-30T12:00:00Z");
  assert.equal(usageKey("checks", d), "2026-10-30:checks");
  const pruned = pruneUsage({ "2026-10-30:checks": 3, "2026-10-29:ingests": 1, "2026-10-01:checks": 9 }, d);
  assert.deepEqual(pruned, { "2026-10-30:checks": 3, "2026-10-29:ingests": 1 });
});
