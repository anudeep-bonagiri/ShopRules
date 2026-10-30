import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTavilyReceipt, receiptLines } from "./tavily-receipt.ts";
import { addExtract, addMap, addSearch, newTrail, setModel } from "./source-trail.ts";

const rule = { query: "q", include_domains: ["ustr.gov"], include_domains_mode: "strict" as const };

test("aggregates calls, credits, and model-free shares per family", () => {
  const modelTrail = setModel(addExtract(addSearch(newTrail(rule), [{ url: "https://ustr.gov/a", title: "", content: "", score: 1 }], ["https://ustr.gov/a"]), ["https://ustr.gov/a"], { results: [{ url: "https://ustr.gov/a", raw_content: "abc" }], failed_results: [] }), { tier: "ultra", ms: 1, cost_usd: 0.02 });
  modelTrail.matched_passages = [{ claim_index: 0, url: "https://ustr.gov/a", start: 0, end: 3 }];
  const taxTrail = addExtract(addMap(newTrail({ query: "q", include_domains: ["comptroller.texas.gov"], include_domains_mode: "prefer" }), "https://comptroller.texas.gov", 30), ["https://comptroller.texas.gov/x"], { results: [{ url: "https://comptroller.texas.gov/x", raw_content: "abc" }], failed_results: [] });
  const r = buildTavilyReceipt(
    [
      { kind: "check", tavily_calls: 2, tavily_credits: 3, llm: [{ tier: "ultra", model: "m", prompt_tokens: 1, completion_tokens: 1, ms: 1, cost_usd: 0.02, purpose: "rule" }], llm_cost_usd: 0.02 },
      { kind: "price_refresh", tavily_calls: 1, tavily_credits: 1, llm: [], llm_cost_usd: 0 },
      { kind: "check", tavily_calls: 2, tavily_credits: 2, llm: [], llm_cost_usd: 0 },
    ],
    [
      { family: "tariff", trail: modelTrail },
      { family: "tax", trail: taxTrail },
      { family: "safety", trail: null },
    ],
  );
  assert.equal(r.by_family.tariff.alerts, 1);
  assert.equal(r.by_family.tariff.search, 1);
  assert.equal(r.by_family.tariff.extract, 1);
  assert.equal(r.by_family.tariff.credits, 3);
  assert.equal(r.by_family.tariff.tavily_only_alerts, 0);
  assert.equal(r.by_family.tariff.passages_matched, 1);
  assert.equal(r.by_family.tax.map, 1);
  assert.equal(r.by_family.tax.tavily_only_alerts, 1);
  assert.equal(r.by_family.safety.alerts, 1);
  assert.equal(r.totals.tavily_calls, 5);
  assert.equal(r.totals.tavily_credits, 6);
  assert.equal(r.totals.map, 1);
  assert.equal(r.totals.runs_without_model, 2);
  assert.equal(r.totals.price_refresh_runs, 1);
  assert.equal(r.totals.llm_cost_usd, 0.02);
  assert.ok(Math.abs(r.tavily_only_ratio - 1 / 3) < 1e-9);
  assert.ok(Math.abs(r.runs_without_model_ratio - 2 / 3) < 1e-9);
  const lines = receiptLines(r);
  assert.match(lines[0]!, /^5 Tavily calls \(6 credits\) across 3 runs; 67% of runs needed no model\.$/);
  assert.match(lines[1]!, /1 price refresh read listings with Extract only/);
  assert.match(lines[2]!, /3 alerts, 33% raised without a model/);
  assert.match(lines[3]!, /1 Map and 0 Crawl calls/);
});

test("empty inputs produce zeros, not NaN", () => {
  const r = buildTavilyReceipt([], []);
  assert.equal(r.tavily_only_ratio, 0);
  assert.equal(r.runs_without_model_ratio, 0);
  assert.equal(receiptLines(r).length, 1);
});
