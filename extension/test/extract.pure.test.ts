// Pure parsing helpers from extract.ts, no DOM needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalProductUrl, currencyFromText, parsePrice, splitMaterials } from "../src/extract.ts";

(globalThis as { location?: unknown }).location = new URL("https://www.etsy.com/listing/1/x");

test("parsePrice handles the formats marketplaces print", () => {
  assert.equal(parsePrice("$1,234.56"), 1234.56);
  assert.equal(parsePrice("US$12.00"), 12);
  assert.equal(parsePrice("€12,34"), 12.34);
  assert.equal(parsePrice("1.234,56"), 1234.56);
  assert.equal(parsePrice("CA$ 1 234,56"), 1234.56);
  assert.equal(parsePrice("free shipping"), null);
});

test("currencyFromText reads the mark or the code", () => {
  assert.equal(currencyFromText("US$12.00"), "USD");
  assert.equal(currencyFromText("CA$12.00"), "CAD");
  assert.equal(currencyFromText("€12,34"), "EUR");
  assert.equal(currencyFromText("12.00 GBP"), "GBP");
  assert.equal(currencyFromText("12"), null);
});

test("splitMaterials normalizes a label into a list", () => {
  assert.deepEqual(splitMaterials("Beech wood, water-based paint; Cotton and Linen"), ["beech wood", "water-based paint", "cotton", "linen"]);
  assert.deepEqual(splitMaterials("Made of aluminum alloy / ABS plastic"), ["aluminum alloy", "abs plastic"]);
  assert.equal(splitMaterials(""), null);
});

test("canonicalProductUrl collapses listing URLs to one per product", () => {
  assert.equal(canonicalProductUrl("https://www.amazon.com/Some-Title/dp/b0cxk7l9qz/ref=sr_1_3?keywords=lamp", "amazon"), "https://www.amazon.com/dp/B0CXK7L9QZ");
  assert.equal(canonicalProductUrl("https://www.etsy.com/listing/1458123456/wooden-rainbow?ref=shop", "etsy"), "https://www.etsy.com/listing/1458123456/wooden-rainbow");
  assert.equal(canonicalProductUrl("https://shop.example.com/collections/all/products/tee?variant=1", "shopify"), "https://shop.example.com/products/tee");
  assert.equal(canonicalProductUrl("not a url", "amazon"), null);
});
