import { test } from "node:test";
import assert from "node:assert/strict";
import { reprice, roundPrice, pricingInputs, type PricingInputs } from "./pricing.ts";

const lamp: PricingInputs = {
  price: 29.99,
  landed_cost: 13.5,
  dutiable_share: 0.85,
  duty_rate_change_pts: 12.5,
  est_cost_change_pct: null,
  units_per_week: 20,
  target_margin_pct: 35,
  rounding: 0.5,
};

test("lamp: a 12.5 pt duty increase raises the price and holds the current margin", () => {
  const r = reprice(lamp);
  assert.equal(r.basis, "duty");
  assert.equal(r.strategy, "hold_margin");
  assert.ok(r.suggested_price !== null && r.suggested_price > 29.99, `suggested ${r.suggested_price} must exceed 29.99`);
  assert.ok(Math.abs((r.suggested_price ?? 0) - 33) <= 0.5, `suggested ${r.suggested_price} should be about $33.00`);
  assert.ok(Math.abs(r.cost_delta - 1.43) < 0.02);
  assert.ok(r.weekly_drag < 0);
  assert.ok(Math.abs(r.old_margin_pct - r.margin_at_suggested_pct) < 1.5, "margin at the new price stays close to the old margin");
  assert.ok(!r.explanation.includes("—"), "no em dashes");
  assert.ok(r.explanation.endsWith("."));
});

test("a positive cost change never yields a price below the current price", () => {
  for (const price of [4.99, 9.5, 29.99, 120, 999.99]) {
    for (const share of [0.2, 0.45, 0.8, 0.95]) {
      for (const pts of [0.5, 2, 7.5, 25, 100]) {
        for (const rounding of [0.5, 0.99, 0.01] as const) {
          for (const target of [10, 35, 60, 90]) {
            const r = reprice({ ...lamp, price, landed_cost: price * share, duty_rate_change_pts: pts, rounding, target_margin_pct: target });
            assert.ok(r.cost_delta > 0);
            if (r.suggested_price !== null) assert.ok(r.suggested_price >= price, `${r.suggested_price} < ${price} (share ${share}, pts ${pts}, r ${rounding})`);
          }
        }
      }
    }
  }
});

test("hold_target is used only when the current margin is below target", () => {
  const r = reprice({ ...lamp, landed_cost: 22, target_margin_pct: 35 }); // margin 26.6%
  assert.equal(r.strategy, "hold_target");
  assert.ok(r.suggested_price !== null && r.suggested_price > 29.99);
  assert.ok(r.margin_at_suggested_pct >= 34.5);
});

test("tiny moves on a healthy margin are absorbed", () => {
  const r = reprice({ ...lamp, duty_rate_change_pts: 0.5 }); // adds about 6 cents
  assert.equal(r.strategy, "absorb");
  assert.equal(r.suggested_price, null);
});

test("falls back to the estimated cost change when no duty rate is given", () => {
  const r = reprice({ ...lamp, duty_rate_change_pts: null, est_cost_change_pct: 10 });
  assert.equal(r.basis, "cost");
  assert.ok(Math.abs(r.cost_delta - 1.35) < 0.01);
});

test("no change and cost decreases do not suggest a price", () => {
  assert.equal(reprice({ ...lamp, duty_rate_change_pts: null }).suggested_price, null);
  const down = reprice({ ...lamp, duty_rate_change_pts: -10 });
  assert.equal(down.suggested_price, null);
  assert.ok(down.new_margin_pct_if_unchanged > down.old_margin_pct);
});

test("rounding modes", () => {
  assert.equal(roundPrice(33.18, 0.5), 33);
  assert.equal(roundPrice(33.26, 0.5), 33.5);
  assert.equal(roundPrice(33.18, 0.99), 32.99);
  assert.equal(roundPrice(33.6, 0.99), 33.99);
  assert.equal(roundPrice(33.186, 0.01), 33.19);
});

test("pricingInputs prefers a seller-set unit cost over the workspace share", () => {
  const a = pricingInputs({ price: 29.99 }, { tariff_rate_change_pct: 12.5 }, { unit_cost_pct: 45 });
  assert.ok(a && Math.abs(a.landed_cost - 13.4955) < 0.001);
  const b = pricingInputs({ price: 29.99, unit_cost: 9 }, { tariff_rate_change_pct: 12.5 }, { unit_cost_pct: 45 });
  assert.equal(b?.landed_cost, 9);
  assert.equal(pricingInputs({ price: null }, null, null), null);
});
