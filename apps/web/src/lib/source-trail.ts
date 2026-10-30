// The source trail: everything Tavily did for one rule check, kept on the
// alert so the seller (and a judge) can see the query, the official pages it
// surfaced, which were read, which passages backed the claims, and whether a
// model was needed at all. Pure builders, no I/O.

import { domainOf, quoteContext } from "./sanity.ts";
import type { TavilyExtractResponse, TavilyResult } from "./tavily.ts";

export interface TrailSearchResult {
  url: string;
  title: string;
  score: number;
  published_date: string | null;
  domain: string;
  /** Picked for extraction. */
  chosen: boolean;
}

export interface TrailExtract {
  url: string;
  chars: number;
  ok: boolean;
  error?: string;
}

export interface TrailPassage {
  claim_index: number;
  url: string;
  start: number;
  end: number;
}

export interface SourceTrail {
  query: string;
  include_domains: string[];
  mode: "strict" | "prefer";
  time_range: string | null;
  search_results: TrailSearchResult[];
  extracted: TrailExtract[];
  mapped: Array<{ base_url: string; urls: number }>;
  crawled: Array<{ base_url: string; pages: number }>;
  hash: string | null;
  matched_passages: TrailPassage[];
  tavily: { search_calls: number; extract_calls: number; map_calls: number; crawl_calls: number; credits: number };
  model: { tier: string; ms: number; cost_usd: number } | null;
  path: "tavily_only" | "model" | "forge";
  started_at: string;
}

export function newTrail(rule: { query: string; include_domains: string[]; include_domains_mode: "strict" | "prefer" }, time_range: string | null = "year", now = new Date()): SourceTrail {
  return {
    query: rule.query,
    include_domains: [...rule.include_domains],
    mode: rule.include_domains_mode,
    time_range,
    search_results: [],
    extracted: [],
    mapped: [],
    crawled: [],
    hash: null,
    matched_passages: [],
    tavily: { search_calls: 0, extract_calls: 0, map_calls: 0, crawl_calls: 0, credits: 0 },
    model: null,
    path: "tavily_only",
    started_at: now.toISOString(),
  };
}

export function addSearch(trail: SourceTrail, results: TavilyResult[], chosenUrls: string[], credits = 2): SourceTrail {
  const chosen = new Set(chosenUrls);
  trail.search_results.push(
    ...results.map((r) => ({ url: r.url, title: r.title ?? "", score: Number.isFinite(r.score) ? Math.round(r.score * 1000) / 1000 : 0, published_date: r.published_date ?? null, domain: domainOf(r.url), chosen: chosen.has(r.url) })),
  );
  trail.tavily.search_calls += 1;
  trail.tavily.credits += credits;
  return trail;
}

export function addExtract(trail: SourceTrail, requested: string[], response: Pick<TavilyExtractResponse, "results" | "failed_results"> | null, credits = 1): SourceTrail {
  const ok = new Map((response?.results ?? []).map((r) => [r.url, r.raw_content?.length ?? 0]));
  const failed = new Map((response?.failed_results ?? []).map((f) => [f.url, f.error]));
  for (const url of requested) {
    if (ok.has(url)) trail.extracted.push({ url, chars: ok.get(url) ?? 0, ok: true });
    else trail.extracted.push({ url, chars: 0, ok: false, error: failed.get(url) ?? (response ? "no text returned" : "extract call failed") });
  }
  trail.tavily.extract_calls += 1;
  trail.tavily.credits += credits;
  return trail;
}

export function addMap(trail: SourceTrail, base_url: string, urls: number, credits = 1): SourceTrail {
  trail.mapped.push({ base_url, urls });
  trail.tavily.map_calls += 1;
  trail.tavily.credits += credits;
  return trail;
}

export function addCrawl(trail: SourceTrail, base_url: string, pages: number, credits = 2): SourceTrail {
  trail.crawled.push({ base_url, pages });
  trail.tavily.crawl_calls += 1;
  trail.tavily.credits += credits;
  return trail;
}

export function setHash(trail: SourceTrail, hash: string): SourceTrail {
  trail.hash = hash;
  return trail;
}

export function setModel(trail: SourceTrail, call: { tier: string; ms: number; cost_usd: number } | null): SourceTrail {
  trail.model = call;
  trail.path = call ? "model" : trail.path === "forge" ? "forge" : "tavily_only";
  return trail;
}

export function setForgePath(trail: SourceTrail): SourceTrail {
  trail.path = "forge";
  return trail;
}

/**
 * Locates each backed claim's quote in the extracted source text (same probe as
 * sanity.ts's quoteContext) and records the character span, so the UI can
 * highlight the exact passage. Unbacked claims get no passage.
 */
export function matchPassages(trail: SourceTrail, claims: Array<{ quote: string; backed: boolean; matched_url: string | null; source_url: string }>, sources: Array<{ url: string; text: string }>): SourceTrail {
  trail.matched_passages = [];
  claims.forEach((c, i) => {
    if (!c.backed) return;
    const probe = c.quote.trim().slice(0, 60).toLowerCase();
    if (probe.length < 15) return;
    const prefer = c.matched_url ?? c.source_url;
    const ordered = [...sources.filter((s) => s.url === prefer), ...sources.filter((s) => s.url !== prefer)];
    for (const s of ordered) {
      const at = s.text.toLowerCase().indexOf(probe);
      if (at >= 0) {
        const ctx = quoteContext(c.quote, [s], s.url);
        const span = Math.max(c.quote.length, Math.min(ctx.length, c.quote.length));
        trail.matched_passages.push({ claim_index: i, url: s.url, start: at, end: Math.min(s.text.length, at + span) });
        break;
      }
    }
  });
  return trail;
}

/** "4 official pages searched on ustr.gov and cbp.gov, 3 extracted, 2 passages matched, model consulted" */
export function summarizeTrail(trail: SourceTrail): string {
  const parts: string[] = [];
  const domains = Array.from(new Set(trail.search_results.map((r) => r.domain))).slice(0, 3);
  if (trail.search_results.length) parts.push(`${trail.search_results.length} official page${trail.search_results.length === 1 ? "" : "s"} searched${domains.length ? ` on ${joinWords(domains)}` : ""}`);
  else if (trail.tavily.search_calls) parts.push("search returned nothing on the allowed domains");
  for (const m of trail.mapped) parts.push(`${m.urls} url${m.urls === 1 ? "" : "s"} mapped on ${domainOf(m.base_url)}`);
  for (const c of trail.crawled) parts.push(`${c.pages} page${c.pages === 1 ? "" : "s"} crawled from ${domainOf(c.base_url)}`);
  const okExtracts = trail.extracted.filter((e) => e.ok).length;
  if (trail.extracted.length) parts.push(`${okExtracts} extracted${okExtracts < trail.extracted.length ? ` (${trail.extracted.length - okExtracts} failed)` : ""}`);
  if (trail.matched_passages.length) parts.push(`${trail.matched_passages.length} passage${trail.matched_passages.length === 1 ? "" : "s"} matched`);
  parts.push(trail.path === "model" ? "model consulted" : trail.path === "forge" ? "forged check ran, no model" : "no model needed");
  return parts.join(", ");
}

function joinWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
