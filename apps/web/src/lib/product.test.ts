import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveProfile, effectivePrice, pricingProduct, sanitizeOverrides, fieldSource } from "./product.ts";
import type { ProductProfile } from "./schemas.ts";

const profile: ProductProfile = {
  title: "Lamp", brand: null, price: 29.99, currency: "USD", category: "Lighting", product_type: "desk lamp", materials: ["abs"], origin_country: null,
  intended_for_children: false, is_cosmetic: false, is_electronic: true, has_battery: true, is_textile: false, is_food_contact: false, is_supplement_or_food: false,
  hts_candidates: [{ code: "8531", description: "Signalling", confidence: 0.9 }], keywords: ["lamp"], summary: "A lamp.",
};

test("seller overrides win over classifier facts and never leak back", () => {
  const p = { price: 29.99, profile, overrides: { origin_country: "cn", hts_heading: "9405", for_children: null, materials: ["aluminum", "abs"] } };
  const e = effectiveProfile(p);
  assert.equal(e.origin_country, "CN");
  assert.equal(e.hts_candidates[0]?.code, "9405");
  assert.equal(e.hts_candidates[0]?.confidence, 1);
  assert.ok(e.hts_candidates.some((c) => c.code === "8531"), "classifier guess kept as an alternative");
  assert.deepEqual(e.materials, ["aluminum", "abs"]);
  assert.equal(p.profile.origin_country, null, "stored profile untouched");
  assert.equal(fieldSource(p, "origin_country"), "product");
  assert.equal(fieldSource(p, "unit_cost"), "default");
});

test("price override and pricing inputs", () => {
  assert.equal(effectivePrice({ price: 29.99, profile, overrides: { price_override: 31 } }), 31);
  assert.equal(effectivePrice({ price: 29.99, profile, overrides: { price_override: null } }), 29.99);
  const pp = pricingProduct({ price: 29.99, profile, overrides: { unit_cost: 12, units_per_week: 40 } });
  assert.equal(pp.unit_cost, 12);
  assert.equal(pp.units_per_week, 40);
  assert.equal(pp.dutiable_share, null);
});

test("sanitizeOverrides validates and lets null clear a field", () => {
  const ok = sanitizeOverrides({ unit_cost: "12.5", dutiable_share: 0.9, units_per_week: 19.6, origin_country: "vn", hts_heading: "9405.20.60", hts_detail: "9405.20", for_children: true, materials: "Cotton, Linen" });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.patch.unit_cost, 12.5);
  assert.equal(ok.patch.units_per_week, 20);
  assert.equal(ok.patch.origin_country, "VN");
  assert.equal(ok.patch.hts_heading, "9405");
  assert.deepEqual(ok.patch.materials, ["cotton", "linen"]);
  const bad = sanitizeOverrides({ unit_cost: -1, hts_heading: "8531", origin_country: "USA", hts_detail: "abc" });
  assert.equal(bad.errors.length, 4);
  const clear = sanitizeOverrides({ unit_cost: null, hts_heading: "" });
  assert.equal(clear.patch.unit_cost, null);
  assert.equal(clear.patch.hts_heading, null);
  assert.equal("units_per_week" in clear.patch, false, "untouched fields stay undefined");
});
