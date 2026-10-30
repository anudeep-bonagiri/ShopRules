import { test } from "node:test";
import assert from "node:assert/strict";
import { addCrawl, addExtract, addMap, addSearch, matchPassages, newTrail, setHash, setModel, summarizeTrail } from "./source-trail.ts";

const rule = { query: "Section 301 China tariff lamps 9405 2026", include_domains: ["ustr.gov", "cbp.gov"], include_domains_mode: "strict" as const };

test("builders record every Tavily call and credits", () => {
  const t = newTrail(rule);
  addSearch(t, [
    { url: "https://ustr.gov/a", title: "A", content: "", score: 0.91234, published_date: "2026-01-02" },
    { url: "https://www.cbp.gov/b", title: "B", content: "", score: 0.5 },
    { url: "https://ustr.gov/c", title: "C", content: "", score: 0.2 },
    { url: "https://ustr.gov/d", title: "D", content: "", score: 0.1 },
  ], ["https://ustr.gov/a", "https://www.cbp.gov/b", "https://ustr.gov/c"]);
  addExtract(t, ["https://ustr.gov/a", "https://www.cbp.gov/b", "https://ustr.gov/c"], { results: [{ url: "https://ustr.gov/a", raw_content: "x".repeat(500) }, { url: "https://www.cbp.gov/b", raw_content: "y".repeat(50) }], failed_results: [{ url: "https://ustr.gov/c", error: "timeout" }] });
  setHash(t, "abc123");
  setModel(t, { tier: "ultra", ms: 4200, cost_usd: 0.0123 });
  assert.equal(t.search_results.length, 4);
  assert.equal(t.search_results[0]!.score, 0.912);
  assert.equal(t.search_results[0]!.domain, "ustr.gov");
  assert.equal(t.search_results[1]!.domain, "cbp.gov");
  assert.equal(t.search_results.filter((r) => r.chosen).length, 3);
  assert.deepEqual(t.extracted.map((e) => e.ok), [true, true, false]);
  assert.equal(t.extracted[2]!.error, "timeout");
  assert.deepEqual(t.tavily, { search_calls: 1, extract_calls: 1, map_calls: 0, crawl_calls: 0, credits: 3 });
  assert.equal(t.path, "model");
  assert.equal(t.hash, "abc123");
});

test("passages are located in the source text for backed claims only", () => {
  const t = newTrail(rule);
  const text = "Notice. For products of China under heading 9405 the additional duty will increase from 25 percent to 37.5 percent effective January 1, 2026. End.";
  matchPassages(
    t,
    [
      { quote: "the additional duty will increase from 25 percent to 37.5 percent", backed: true, matched_url: "https://ustr.gov/a", source_url: "https://ustr.gov/a" },
      { quote: "something the page never said at all, long enough", backed: false, matched_url: null, source_url: "https://ustr.gov/a" },
    ],
    [{ url: "https://ustr.gov/a", text }],
  );
  assert.equal(t.matched_passages.length, 1);
  const p = t.matched_passages[0]!;
  assert.equal(p.claim_index, 0);
  assert.equal(text.slice(p.start, p.end), "the additional duty will increase from 25 percent to 37.5 percent");
});

test("summary reads as one plain line for each path", () => {
  const t = newTrail(rule);
  addSearch(t, [
    { url: "https://ustr.gov/a", title: "A", content: "", score: 0.9 },
    { url: "https://www.cbp.gov/b", title: "B", content: "", score: 0.5 },
    { url: "https://ustr.gov/c", title: "C", content: "", score: 0.2 },
    { url: "https://ustr.gov/d", title: "D", content: "", score: 0.1 },
  ], ["https://ustr.gov/a", "https://www.cbp.gov/b", "https://ustr.gov/c"]);
  addExtract(t, ["https://ustr.gov/a", "https://www.cbp.gov/b", "https://ustr.gov/c"], { results: [{ url: "https://ustr.gov/a", raw_content: "abc" }, { url: "https://www.cbp.gov/b", raw_content: "abc" }, { url: "https://ustr.gov/c", raw_content: "abc" }], failed_results: [] });
  t.matched_passages = [{ claim_index: 0, url: "https://ustr.gov/a", start: 0, end: 10 }, { claim_index: 1, url: "https://ustr.gov/a", start: 20, end: 30 }];
  setModel(t, { tier: "ultra", ms: 1, cost_usd: 0.01 });
  assert.equal(summarizeTrail(t), "4 official pages searched on ustr.gov and cbp.gov, 3 extracted, 2 passages matched, model consulted");
  const u = newTrail({ query: "q", include_domains: ["comptroller.texas.gov"], include_domains_mode: "prefer" });
  addMap(u, "https://comptroller.texas.gov", 31);
  addExtract(u, ["https://comptroller.texas.gov/x"], { results: [{ url: "https://comptroller.texas.gov/x", raw_content: "abc" }], failed_results: [] });
  assert.equal(summarizeTrail(u), "31 urls mapped on comptroller.texas.gov, 1 extracted, no model needed");
  const c = newTrail(rule);
  addCrawl(c, "https://tax.ny.gov/bus/st/remote-sellers.htm", 6);
  assert.equal(summarizeTrail(c), "6 pages crawled from tax.ny.gov, no model needed");
  const e = newTrail(rule);
  addSearch(e, [], []);
  assert.equal(summarizeTrail(e), "search returned nothing on the allowed domains, no model needed");
  assert.ok(!summarizeTrail(t).includes("—"));
});
