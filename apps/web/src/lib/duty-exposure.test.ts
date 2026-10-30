import { test } from "node:test";
import assert from "node:assert/strict";
import { dutyExposure, dutyPerUnit, stackedRateLabel, SECTION_301_SEEDS } from "./duty-exposure.ts";
import { reprice } from "./pricing.ts";

const read = (general: string, pct: number | null) => ({ general, general_pct: pct, verified: true, url: "https://hts.usitc.gov/reststop/search?keyword=9405", read_at: "2026-10-30T00:00:00Z" });

test("China lamp: general read plus Section 301 List 3 seed, origin surcharge unknown", () => {
  const e = dutyExposure({ origin_country: "CN", heading: "9405", duty_rate: read("3.9%", 3.9) });
  assert.equal(e.domestic, false);
  assert.equal(e.layers[0].status, "read");
  assert.equal(e.layers[1].status, "seed");
  assert.equal(e.layers[1].rate_pct, 25);
  assert.equal(e.layers[2].status, "unknown");
  assert.equal(e.known_pct, 28.9);
  assert.equal(e.additional_pts, 25);
  assert.equal(e.complete, false);
  assert.deepEqual(e.unknown, ["origin"]);
  assert.equal(stackedRateLabel(e), "28.9%+");
  assert.match(e.summary, /3\.9% general \+ 25% Section 301 List 3 \(seed\), origin surcharge not set/);
});

test("China toy: general Free, List 4B never took effect, surcharge set by the seller completes the stack", () => {
  const e = dutyExposure({ origin_country: "CN", heading: "9503", duty_rate: read("Free", 0), surcharge_pct: 20 });
  assert.equal(e.layers[1].rate_pct, 0);
  assert.equal(e.layers[1].status, "seed");
  assert.equal(e.layers[2].status, "set");
  assert.equal(e.known_pct, 20);
  assert.equal(e.additional_pts, 20);
  assert.equal(e.complete, true);
  assert.equal(stackedRateLabel(e), "20%");
  assert.equal(e.summary, "Free general + no Section 301 List 4B suspended (seed) + 20% Origin surcharge");
});

test("US origin: no import duty, every layer none, stacked 0", () => {
  const e = dutyExposure({ origin_country: "US", heading: "6912", duty_rate: read("8.5%", 8.5) });
  assert.equal(e.domestic, true);
  assert.ok(e.layers.every((l) => l.status === "none" && l.rate_pct === 0));
  assert.equal(e.known_pct, 0);
  assert.equal(e.additional_pts, 0);
  assert.equal(stackedRateLabel(e), "0%");
  assert.match(e.summary, /no import duty/);
});

test("Vietnam tee: Section 301 does not apply, general read, surcharge unknown", () => {
  const e = dutyExposure({ origin_country: "VN", heading: "6109", duty_rate: read("16.5%", 16.5) });
  assert.equal(e.layers[1].status, "none");
  assert.equal(e.additional_pts, 0);
  assert.equal(e.known_pct, 16.5);
  assert.equal(stackedRateLabel(e), "16.5%+");
});

test("heading outside the seed table is unknown, never zero", () => {
  const e = dutyExposure({ origin_country: "CN", heading: "9506", duty_rate: null });
  assert.equal(SECTION_301_SEEDS["9506"], undefined);
  assert.equal(e.layers[0].status, "unknown");
  assert.equal(e.layers[1].status, "unknown");
  assert.equal(stackedRateLabel(e), "Unknown");
});

test("a compound general rate stays unknown instead of a wrong percent", () => {
  const e = dutyExposure({ origin_country: "CN", heading: "6912", duty_rate: read("8.5¢/kg + 4%", null) });
  assert.equal(e.layers[0].status, "unknown");
  assert.match(e.layers[0].note, /does not reduce to a percent/);
});

test("duty per unit and the exposure reprice use the same math as an alert", () => {
  const e = dutyExposure({ origin_country: "CN", heading: "9405", duty_rate: read("3.9%", 3.9) });
  assert.equal(dutyPerUnit(e, 13.5, 0.85), 3.32);
  const r = reprice({ price: 29.99, landed_cost: 13.5, dutiable_share: 0.85, duty_rate_change_pts: e.additional_pts, est_cost_change_pct: null, units_per_week: 20, target_margin_pct: 35, rounding: 0.5 });
  assert.equal(r.basis, "duty");
  assert.equal(r.cost_delta, 13.5 * 0.85 * 0.25);
  assert.ok(r.suggested_price != null && r.suggested_price > 29.99);
});
