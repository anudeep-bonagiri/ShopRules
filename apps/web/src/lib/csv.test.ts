import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateOrders, detectOrdersSource, parseCsv, stateCode } from "./csv.ts";

test("csv parser handles quotes, embedded commas and newlines, CRLF, and a BOM", () => {
  const text = '﻿a,b,c\r\n1,"x, y","line1\nline2"\r\n2,"she said ""hi""",\r\n';
  assert.deepEqual(parseCsv(text), [["a", "b", "c"], ["1", "x, y", "line1\nline2"], ["2", 'she said "hi"', ""]]);
});

test("state codes from names and abbreviations", () => {
  assert.equal(stateCode("Texas"), "TX");
  assert.equal(stateCode("tx"), "TX");
  assert.equal(stateCode("New York"), "NY");
  assert.equal(stateCode("Ontario"), null);
});

const SHOPIFY = [
  "Name,Email,Financial Status,Paid at,Fulfillment Status,Currency,Subtotal,Shipping,Taxes,Total,Created at,Lineitem quantity,Lineitem name,Shipping Province,Shipping Country",
  "#1001,a@x.com,paid,2026-03-01 10:00:00 -0500,fulfilled,USD,40.00,5.00,0,45.00,2026-03-01 10:00:00 -0500,1,Tee,Texas,US",
  ",,,,,,,,,,,1,Second item,,",
  "#1002,b@x.com,paid,2026-04-02 10:00:00 -0500,fulfilled,USD,30.00,0,0,30.00,2026-04-02 10:00:00 -0500,1,Tee,TX,US",
  "#1003,c@x.com,refunded,2026-04-03 10:00:00 -0500,fulfilled,USD,30.00,0,0,30.00,2026-04-03 10:00:00 -0500,1,Tee,CA,US",
  "#0900,d@x.com,paid,2025-11-20 10:00:00 -0500,fulfilled,USD,100.00,0,0,100.00,2025-11-20 10:00:00 -0500,1,Tee,California,US",
  "#0100,e@x.com,paid,2023-01-20 10:00:00 -0500,fulfilled,USD,100.00,0,0,100.00,2023-01-20 10:00:00 -0500,1,Tee,California,US",
].join("\n");

test("shopify export: one order per Name, refunds skipped, two calendar years kept", () => {
  assert.equal(detectOrdersSource(SHOPIFY.split("\n")[0].split(",")), "shopify");
  const a = aggregateOrders(SHOPIFY, 2026);
  assert.equal(a.source, "shopify");
  assert.deepEqual(a.by_year["2026"]["TX"], { dollars: 75, orders: 2 });
  assert.equal(a.by_year["2026"]["CA"], undefined, "refunded order skipped");
  assert.deepEqual(a.by_year["2025"]["CA"], { dollars: 100, orders: 1 });
  assert.equal(a.by_year["2023"], undefined, "older years dropped");
  assert.equal(a.orders_seen, 5);
  assert.equal(a.orders_skipped, 2);
  assert.deepEqual(a.states, ["CA", "TX"]);
});

const ETSY = [
  "Sale Date,Order ID,Buyer User ID,Full Name,First Name,Last Name,Number of Items,Payment Method,Date Shipped,Street 1,Street 2,Ship City,Ship State,Ship Zipcode,Ship Country,Currency,Order Value,Coupon Code,Coupon Details,Discount Amount,Shipping Discount,Order Shipping,Order Sales Tax,Item Total,Order Total,Status,Card Processing Fees,Order Net,Adjusted Order Total,Adjusted Card Processing Fees,Adjusted Net Order Amount,Buyer,Order Type,Payment Type,InPerson Discount,InPerson Location,SKU",
  '02/14/26,3400000001,u1,"Doe, Jane",Jane,Doe,1,Etsy,02/15/26,1 Main St,,Austin,TX,78701,United States,USD,34.00,,,0,0,5.00,2.80,34.00,41.80,Paid,2.50,39.30,41.80,2.50,39.30,jane,online,etsy_payments,,,',
  '09/01/25,3400000002,u2,"Roe, Rick",Rick,Roe,2,Etsy,09/02/25,2 Elm St,,Dallas,TX,75201,United States,USD,68.00,,,0,0,5.00,5.60,68.00,78.60,Paid,3.50,75.10,78.60,3.50,75.10,rick,online,etsy_payments,,,',
].join("\n");

test("etsy export: one line per order, Ship State and Order Total", () => {
  const a = aggregateOrders(ETSY, 2026);
  assert.equal(a.source, "etsy");
  assert.deepEqual(a.by_year["2026"]["TX"], { dollars: 41.8, orders: 1 });
  assert.deepEqual(a.by_year["2025"]["TX"], { dollars: 78.6, orders: 1 });
  assert.throws(() => aggregateOrders("foo,bar\n1,2"), /Not a Shopify Orders or Etsy Orders export/);
});
