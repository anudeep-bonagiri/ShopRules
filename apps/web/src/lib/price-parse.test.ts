import { test } from "node:test";
import assert from "node:assert/strict";
import { changedByACent, isPlausibleMove, parsePriceFromContent, parsePriceNumber, priceFromJsonLd, priceFromOpenGraph, priceFromShopifyJson, priceFromText } from "./price-parse.ts";

test("parsePriceNumber handles US, EU and spaced formats", () => {
  assert.equal(parsePriceNumber("$1,234.56"), 1234.56);
  assert.equal(parsePriceNumber("US$12.00"), 12);
  assert.equal(parsePriceNumber("€12,34"), 12.34);
  assert.equal(parsePriceNumber("1.234,56"), 1234.56);
  assert.equal(parsePriceNumber("1 234,56"), 1234.56);
  assert.equal(parsePriceNumber(29.99), 29.99);
  assert.equal(parsePriceNumber("free"), null);
  assert.equal(parsePriceNumber("0"), null);
});

test("Shopify .json and .js documents", () => {
  assert.deepEqual(priceFromShopifyJson({ product: { variants: [{ price: "100.00", available: false }, { price: "98.00", available: true }] } })?.price, 98);
  assert.equal(priceFromShopifyJson({ variants: [{ price: "42.00" }] })?.price, 42);
  assert.equal(priceFromShopifyJson({ price: 4200, variants: [] })?.price, 42);
  assert.equal(priceFromShopifyJson({}), null);
});

const HTML = `<html><head>
<meta property="og:title" content="Lamp" />
<meta property="og:price:amount" content="31.50" />
<meta property="og:price:currency" content="USD" />
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Lamp","offers":{"@type":"Offer","price":"29.99","priceCurrency":"USD"}}</script>
</head><body>Save $5.00 today. Price: $29.99. Shipping $4.99.</body></html>`;

test("JSON-LD wins over Open Graph wins over text", () => {
  assert.equal(priceFromJsonLd(HTML)?.price, 29.99);
  assert.equal(priceFromJsonLd(HTML)?.currency, "USD");
  assert.equal(priceFromOpenGraph(HTML)?.price, 31.5);
  const best = parsePriceFromContent(HTML);
  assert.equal(best?.method, "json_ld");
  const noLd = HTML.replace(/<script[\s\S]*?<\/script>/, "");
  assert.equal(parsePriceFromContent(noLd)?.method, "open_graph");
});

test("text fallback prefers the amount closest to the last known price", () => {
  const md = "# Lamp\n\nWas $39.99, now **$29.99**. Shipping $4.99. Bundle: $59.98.";
  assert.equal(priceFromText(md)?.price, 39.99, "first amount without a hint");
  assert.equal(priceFromText(md, { near: 30 })?.price, 29.99);
  assert.equal(priceFromText(md, { near: 30 })?.confidence, 0.6);
  assert.equal(parsePriceFromContent(md, { near: 58 })?.price, 59.98);
  assert.equal(priceFromText("no numbers here"), null);
});

test("plausibility and cent change", () => {
  assert.ok(isPlausibleMove(29.99, 33));
  assert.ok(!isPlausibleMove(29.99, 4.99), "a shipping fee is not the price");
  assert.ok(!isPlausibleMove(29.99, 299));
  assert.ok(isPlausibleMove(null, 10));
  assert.ok(changedByACent(29.99, 30));
  assert.ok(!changedByACent(29.99, 29.994));
});
