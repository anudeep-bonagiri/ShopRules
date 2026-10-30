import { test } from "node:test";
import assert from "node:assert/strict";
import { NEXUS_SEEDS, describeThreshold, dollarsIn, guardNexusParse, nexusProgress, nexusSeed, transactionsIn } from "./nexus.ts";

test("seed file covers the sales-tax states with sane shapes", () => {
  assert.ok(NEXUS_SEEDS.length >= 44);
  for (const s of NEXUS_SEEDS) {
    assert.match(s.state, /^[A-Z]{2}$/);
    assert.ok(s.source_url.startsWith("https://"));
    assert.ok(s.source_url.includes(s.dor_domain.replace(/^www\./, "")), `${s.state} source not on its domain`);
    assert.ok(s.dollars == null || s.dollars >= 100000);
    assert.ok(["or", "and", null].includes(s.operator));
    if (s.operator) assert.ok(s.dollars != null && s.transactions != null, `${s.state} operator without both tests`);
  }
  assert.equal(nexusSeed("tx")?.dollars, 500000);
  assert.equal(nexusSeed("NY")?.operator, "and");
  assert.equal(nexusSeed("ZZ"), null);
  assert.equal(describeThreshold(nexusSeed("NY")!), "$500,000 and 100 transactions");
  assert.equal(describeThreshold(nexusSeed("TX")!), "$500,000");
});

test("dollar and transaction parsing", () => {
  assert.deepEqual(dollarsIn("more than $500,000 or $100,000.00 in sales, 250,000 dollars"), [500000, 100000, 250000]);
  assert.deepEqual(transactionsIn("200 or more separate transactions, or 100 sales"), [200, 100]);
});

test("parsed nexus values count only when a backed quote states them", () => {
  const quote = "Remote sellers with more than $100,000 in gross sales or 200 or more separate transactions in the previous or current calendar year must register";
  const ok = guardNexusParse({ dollars: 100000, transactions: 200, operator: "and" }, quote);
  assert.equal(ok.verified, true);
  assert.deepEqual(ok.parsed, { dollars: 100000, transactions: 200, operator: "or" }, "operator follows the quote, not the model");
  const partly = guardNexusParse({ dollars: 250000, transactions: 200, operator: "or" }, quote);
  assert.equal(partly.verified, true);
  assert.equal(partly.parsed?.dollars, null);
  assert.equal(partly.parsed?.transactions, 200);
  assert.match(partly.reason ?? "", /250,000/);
  const none = guardNexusParse({ dollars: 250000, transactions: null, operator: null }, quote);
  assert.equal(none.verified, false);
  assert.equal(guardNexusParse(null, quote).verified, false);
});

test("progress uses both tests and says which binds", () => {
  const or = nexusProgress({ threshold: { dollars: 100000, transactions: 200, operator: "or" }, sales: 40000, transactions: 180 });
  assert.equal(or.binding, "transactions");
  assert.equal(Math.round(or.pct ?? 0), 90);
  assert.equal(or.tone, "warning");
  assert.match(or.summary, /transaction test binds/);
  const and = nexusProgress({ threshold: { dollars: 500000, transactions: 100, operator: "and" }, sales: 600000, transactions: 50 });
  assert.equal(and.binding, "transactions");
  assert.equal(and.crossed, false, "both tests must be met under and");
  const single = nexusProgress({ threshold: { dollars: 500000, transactions: null, operator: null }, sales: 510000, transactions: 9999 });
  assert.equal(single.crossed, true);
  assert.equal(single.tone, "critical");
  const empty = nexusProgress({ threshold: { dollars: 500000, transactions: null, operator: null }, sales: null, transactions: null });
  assert.equal(empty.pct, null);
});
