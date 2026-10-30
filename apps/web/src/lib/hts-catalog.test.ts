import { test } from "node:test";
import assert from "node:assert/strict";
import { HTS_CATALOG, finalizeHts, keywordMatches, isCatalogHeading } from "./hts-catalog.ts";

test("catalog has unique four-digit headings and the required ones", () => {
  const codes = HTS_CATALOG.map((h) => h.heading);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.length >= 80, `only ${codes.length} headings`);
  for (const c of codes) assert.match(c, /^\d{4}$/);
  for (const must of ["9503", "9405", "8513", "6109", "6403", "4202", "7117", "3304", "3406", "9403", "4901", "8504", "8517", "9619"]) assert.ok(codes.includes(must), must);
});

const LAMP_TITLE = "USB-C Rechargeable LED Desk Lamp with Lithium Battery, 3 Color Modes, Foldable";
const LAMP_TEXT = "Portable desk lamp with built-in 2000mAh lithium-ion battery, USB-C charging cable included, touch dimmer, 3 color temperatures. Aluminum alloy and ABS body. Country of origin: China. FCC and CE marked.";

test("the demo lamp lands on 9405 or 8513 by keywords", () => {
  const top = keywordMatches(LAMP_TITLE, LAMP_TEXT)[0];
  assert.ok(top && ["9405", "8513"].includes(top.heading.heading), `got ${top?.heading.heading}`);
});

test("an off-list model heading (8531) is replaced by the keyword match at <= 0.5", () => {
  const r = finalizeHts({ heading: "8531.10", alternatives: [], confidence: 0.92 }, LAMP_TITLE, LAMP_TEXT);
  assert.ok(r.guarded);
  assert.ok(["9405", "8513"].includes(r.candidates[0]!.code));
  assert.ok(r.candidates[0]!.confidence <= 0.5);
});

test("an on-list heading with keyword support keeps the model's confidence", () => {
  const r = finalizeHts({ heading: "9405", alternatives: ["8513"], confidence: 0.8 }, LAMP_TITLE, LAMP_TEXT);
  assert.equal(r.guarded, false);
  assert.equal(r.candidates[0]!.code, "9405");
  assert.equal(r.candidates[0]!.confidence, 0.8);
  assert.ok(r.candidates.some((c) => c.code === "8513"));
});

test("an on-list heading contradicted by strong keywords is capped at 0.5", () => {
  const r = finalizeHts({ heading: "8528", alternatives: [], confidence: 0.9 }, LAMP_TITLE, LAMP_TEXT);
  assert.ok(r.guarded);
  assert.equal(r.candidates[0]!.code, "8528");
  assert.ok(r.candidates[0]!.confidence <= 0.5);
  assert.ok(["9405", "8513"].includes(r.candidates[1]!.code));
});

test("the other demo products match toys and t-shirts", () => {
  const toy = keywordMatches("Wooden Rainbow Stacker Toy, Montessori Stacking Blocks for Toddlers 1-3", "Handmade beech wood stacking rainbow, 7 pieces, finished with water-based non-toxic paint.")[0];
  assert.equal(toy?.heading.heading, "9503");
  const tee = keywordMatches("Organic Cotton Oversized Tee, Garment Dyed, Unisex", "Heavyweight 100% organic cotton jersey, 240 gsm, garment dyed in small batches.")[0];
  assert.equal(tee?.heading.heading, "6109");
  const shoe = keywordMatches("Men's Wool Runners", "Our Wool Runners are lightweight sneakers made with merino wool uppers.")[0];
  assert.equal(shoe?.heading.heading, "6404");
});

test("isCatalogHeading accepts 6 and 8 digit codes under a catalog heading", () => {
  assert.ok(isCatalogHeading("9405.20.60"));
  assert.ok(!isCatalogHeading("8531.10"));
  assert.ok(!isCatalogHeading(null));
});
