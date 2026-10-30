// Tavily receipt: how much of the watching was done by Tavily alone (Search,
// Extract, Map, Crawl) versus with a model, aggregated per rule family from the
// source trails on alerts and the run records. Pure, no I/O.

import type { RunRow } from "./db";
import type { SourceTrail } from "./source-trail.ts";

export type Family = "tariff" | "safety" | "tax" | "policy";
export const FAMILIES: Family[] = ["tariff", "safety", "tax", "policy"];

export interface FamilyReceipt {
  search: number;
  extract: number;
  map: number;
  crawl: number;
  credits: number;
  alerts: number;
  /** Alerts raised without any model call (forged check or pure parse). */
  tavily_only_alerts: number;
  passages_matched: number;
}

export interface TavilyReceipt {
  by_family: Record<Family, FamilyReceipt>;
  totals: {
    tavily_calls: number;
    tavily_credits: number;
    search: number;
    extract: number;
    map: number;
    crawl: number;
    alerts: number;
    tavily_only_alerts: number;
    runs: number;
    runs_without_model: number;
    price_refresh_runs: number;
    llm_cost_usd: number;
  };
  /** Share of alerts that needed no model. */
  tavily_only_ratio: number;
  /** Share of runs that needed no model (price refreshes, unchanged sources, forged checks). */
  runs_without_model_ratio: number;
}

export interface AlertWithTrail {
  family: Family;
  trail?: SourceTrail | null;
}

function emptyFamily(): FamilyReceipt {
  return { search: 0, extract: 0, map: 0, crawl: 0, credits: 0, alerts: 0, tavily_only_alerts: 0, passages_matched: 0 };
}

export function buildTavilyReceipt(runs: Pick<RunRow, "kind" | "tavily_calls" | "tavily_credits" | "llm" | "llm_cost_usd">[], alerts: AlertWithTrail[]): TavilyReceipt {
  const by_family = { tariff: emptyFamily(), safety: emptyFamily(), tax: emptyFamily(), policy: emptyFamily() } as Record<Family, FamilyReceipt>;
  let search = 0;
  let extract = 0;
  let map = 0;
  let crawl = 0;
  let tavilyOnly = 0;
  for (const a of alerts) {
    const f = by_family[a.family] ?? (by_family[a.family] = emptyFamily());
    f.alerts += 1;
    const t = a.trail;
    if (!t) continue;
    f.search += t.tavily.search_calls;
    f.extract += t.tavily.extract_calls;
    f.map += t.tavily.map_calls;
    f.crawl += t.tavily.crawl_calls;
    f.credits += t.tavily.credits;
    f.passages_matched += t.matched_passages.length;
    search += t.tavily.search_calls;
    extract += t.tavily.extract_calls;
    map += t.tavily.map_calls;
    crawl += t.tavily.crawl_calls;
    if (t.path !== "model") {
      f.tavily_only_alerts += 1;
      tavilyOnly += 1;
    }
  }
  const runsWithoutModel = runs.filter((r) => (r.llm?.length ?? 0) === 0).length;
  const priceRefresh = runs.filter((r) => /price/i.test(r.kind)).length;
  const totals = {
    tavily_calls: runs.reduce((s, r) => s + (r.tavily_calls ?? 0), 0),
    tavily_credits: Math.round(runs.reduce((s, r) => s + (r.tavily_credits ?? 0), 0) * 100) / 100,
    search,
    extract,
    map,
    crawl,
    alerts: alerts.length,
    tavily_only_alerts: tavilyOnly,
    runs: runs.length,
    runs_without_model: runsWithoutModel,
    price_refresh_runs: priceRefresh,
    llm_cost_usd: Math.round(runs.reduce((s, r) => s + (r.llm_cost_usd ?? 0), 0) * 1_000_000) / 1_000_000,
  };
  return {
    by_family,
    totals,
    tavily_only_ratio: alerts.length ? tavilyOnly / alerts.length : 0,
    runs_without_model_ratio: runs.length ? runsWithoutModel / runs.length : 0,
  };
}

/** Captions for the receipt page. */
export function receiptLines(r: TavilyReceipt): string[] {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = [
    `${r.totals.tavily_calls} Tavily call${r.totals.tavily_calls === 1 ? "" : "s"} (${r.totals.tavily_credits} credits) across ${r.totals.runs} run${r.totals.runs === 1 ? "" : "s"}; ${pct(r.runs_without_model_ratio)} of runs needed no model.`,
  ];
  if (r.totals.price_refresh_runs) lines.push(`${r.totals.price_refresh_runs} price refresh${r.totals.price_refresh_runs === 1 ? "" : "es"} read listings with Extract only.`);
  if (r.totals.alerts) lines.push(`${r.totals.alerts} alert${r.totals.alerts === 1 ? "" : "s"}, ${pct(r.tavily_only_ratio)} raised without a model (forged checks and parsed thresholds).`);
  if (r.totals.map || r.totals.crawl) lines.push(`${r.totals.map} Map and ${r.totals.crawl} Crawl call${r.totals.crawl === 1 ? "" : "s"} walked state revenue sites for nexus thresholds.`);
  return lines;
}
