import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShopifyJson, shopifyJsonUrlFor } from "./shopify-json.ts";

test("product handle to .json url, nothing for other paths", () => {
  assert.equal(shopifyJsonUrlFor("https://www.allbirds.com/products/mens-tree-runners?variant=1"), "https://www.allbirds.com/products/mens-tree-runners.json");
  assert.equal(shopifyJsonUrlFor("https://www.allbirds.com/collections/mens"), null);
  assert.equal(shopifyJsonUrlFor("not a url"), null);
});

test("parses title, first available variant price, image and plain-text body", () => {
  const p = parseShopifyJson({
    product: {
      title: "  Night Light   Bunny ",
      body_html: "<p>Soft silicone <b>night light</b>&nbsp;with a coin battery.</p>",
      vendor: "Glow Co",
      product_type: "Nursery",
      variants: [
        { price: "24.00", available: false },
        { price: "26.50", available: true },
      ],
      images: [{ src: "https://cdn.shopify.com/s/files/1/bunny.jpg" }],
    },
  });
  assert.ok(p);
  assert.equal(p.title, "Night Light Bunny");
  assert.equal(p.price, 26.5);
  assert.equal(p.image, "https://cdn.shopify.com/s/files/1/bunny.jpg");
  assert.equal(p.description, "Soft silicone night light with a coin battery.");
  assert.equal(p.product_type, "Nursery");
  assert.equal(p.vendor, "Glow Co");
});

test("a non-product answer is null", () => {
  assert.equal(parseShopifyJson({ errors: "Not Found" }), null);
  assert.equal(parseShopifyJson(null), null);
});
