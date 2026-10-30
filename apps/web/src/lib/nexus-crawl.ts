// Verifies a state's economic nexus threshold against the state revenue site
// with Tavily Map (find the remote-seller pages), Tavily Extract (read them),
// and a deterministic parser. Falls back to Tavily Crawl of the seed URL when
// Map returns nothing. No model is involved; numbers come only from a quote
// that the existing verifier can match in the extracted text.

import type { Meter } from "./schemas";
import { dollarsIn, transactionsIn, type NexusOperator, type NexusPeriod, type NexusThreshold } from "./nexus.ts";
import { domainOf } from "./sanity.ts";

// Tavily is loaded lazily: tests inject fakes and never touch the network or the
// client module, and the client module itself pulls in app-only imports.
type TavilyModule = typeof import("./tavily.ts");

export interface ThresholdParse {
  dollars: number | null;
  transactions: number | null;
  operator: NexusOperator;
  period: NexusPeriod | null;
  /** Exact sentence from the page; the verifier can back it. */
  quote: string;
  url: string;
}

export interface NexusVerification {
  state: string;
  verified: boolean;
  parsed: ThresholdParse | null;
  matches_seed: boolean;
  differences: string[];
  sources: Array<{ url: string; title: string }>;
  /** URLs discovered by Map or Crawl. */
  crawled: number;
  /** Pages whose text was read. */
  extracted: number;
  method: "map+extract" | "crawl" | "extract" | "none";
  reason: string | null;
  checked_at: string;
  /** Plain English, one sentence, no dashes. */
  line: string;
}

const PATH_SIGNALS: Array<[RegExp, number]> = [
  [/remote[-_ ]?sellers?/i, 6],
  [/economic[-_ ]?nexus/i, 6],
  [/\bnexus\b/i, 5],
  [/marketplace[-_ ]?(facilitator|provider|seller)s?/i, 4],
  [/wayfair/i, 3],
  [/threshold/i, 3],
  [/out[-_ ]?of[-_ ]?state/i, 3],
  [/sales[-_ ]?(and[-_ ]?)?use/i, 1],
  [/sales[-_ ]?tax/i, 1],
  [/faq|frequently/i, 1],
  [/\.pdf$/i, 1],
  [/news|press|release|blog|careers|contact|login|forms?\//i, -3],
  [/\b(201\d)\b/, -2],
];

/** Scores a URL by how much its path looks like a remote-seller nexus page. Pure. */
export function scoreCandidateUrl(url: string): number {
  let path: string;
  try {
    const u = new URL(url);
    path = decodeURIComponent(`${u.pathname}${u.search}`);
  } catch {
    return -10;
  }
  let score = 0;
  for (const [re, w] of PATH_SIGNALS) if (re.test(path)) score += w;
  const depth = path.split("/").filter(Boolean).length;
  if (depth > 5) score -= depth - 5;
  return score;
}

/** Picks up to `limit` URLs to read: the seed URL first, then the best-scoring same-domain pages. Pure. */
export function pickCandidateUrls(urls: string[], seed: Pick<NexusThreshold, "dor_domain" | "source_url">, limit = 3): string[] {
  const dom = seed.dor_domain.toLowerCase();
  const sameDomain = (u: string) => {
    const d = domainOf(u).toLowerCase();
    return d === dom || d.endsWith(`.${dom}`);
  };
  const scored = Array.from(new Set(urls.filter((u) => /^https?:\/\//i.test(u) && sameDomain(u))))
    .map((u) => ({ u, s: scoreCandidateUrl(u) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.u.length - b.u.length);
  const out: string[] = [];
  if (seed.source_url) out.push(seed.source_url);
  for (const { u } of scored) {
    if (out.length >= limit) break;
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, limit);
}

const NEXUS_VOCAB = /remote seller|nexus|threshold|gross (?:sales|revenue|receipts)|total (?:sales|revenue)|taxable sales|retail sales|must (?:register|collect|obtain)|required to (?:register|collect)|economic presence|safe harbor|small seller/i;

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.;!?])\s+(?=[A-Z$0-9"(])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 700);
}

function periodIn(text: string): NexusPeriod | null {
  const t = text.toLowerCase();
  if (/(?:current|present)\s+or\s+(?:previous|prior|preceding|immediately preceding)\s+(?:calendar\s+)?year|(?:previous|prior|preceding)\s+or\s+current\s+(?:calendar\s+)?year|(?:previous|prior|preceding)\s+(?:calendar\s+)?year\b/.test(t)) return "previous_or_current_year";
  if (/(?:preceding|prior|previous|last|trailing|rolling)\s+(?:twelve|12)\s+(?:calendar\s+)?months|12[- ]month period|twelve[- ]month period|four (?:preceding )?(?:sales tax )?quarters/.test(t)) return "12_months";
  return null;
}

// The word that joins the dollar test and the transaction test, read from the
// text between the two numbers ("$100,000 or more, or ... 200 or more separate
// transactions" is "or"; "$500,000 ... and conducted more than 100 sales" is "and").
function operatorIn(text: string, dollars: number | null, transactions: number | null): NexusOperator {
  if (dollars == null || transactions == null) return null;
  const t = text.toLowerCase();
  const dIdx = t.search(new RegExp(`\\$\\s?${dollars.toLocaleString("en-US").replace(/,/g, ",?")}`));
  const xIdx = t.search(new RegExp(`\\b${transactions}\\s+(?:or more\\s+)?(?:separate\\s+|retail\\s+)?(?:transactions|sales|orders)`));
  const between = dIdx >= 0 && xIdx >= 0 ? t.slice(Math.min(dIdx, xIdx), Math.max(dIdx, xIdx)) : t;
  const scrub = between.replace(/\bor more\b/g, "").replace(/\bor greater\b/g, "").replace(/\bor exceed\w*\b/g, "");
  const orIdx = scrub.search(/\bor\b/);
  const andIdx = scrub.search(/\band\b(?!\s+use\b)(?!\s+local\b)/);
  if (orIdx >= 0 && (andIdx < 0 || orIdx < andIdx)) return "or";
  if (andIdx >= 0) return "and";
  return null;
}

/**
 * Finds the threshold sentence in a page and reads dollars, transactions, the
 * operator between them, and the measurement period. Pure, deterministic,
 * returns null rather than guessing when no sentence states a dollar threshold.
 */
export function parseThresholdFromText(text: string, url = ""): ThresholdParse | null {
  const sentences = splitSentences(text);
  let best: { parse: ThresholdParse; score: number } | null = null;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const dollars = dollarsIn(s).filter((d) => d >= 10_000 && d <= 5_000_000);
    if (dollars.length === 0) continue;
    if (!NEXUS_VOCAB.test(s) && !(i > 0 && NEXUS_VOCAB.test(sentences[i - 1]))) continue;
    const txs = transactionsIn(s).filter((n) => n >= 50 && n <= 1000);
    const dollarsPick = dollars.length === 1 ? dollars[0] : dollars.sort((a, b) => a - b)[0];
    const tx = txs.length ? txs[0] : null;
    const period = periodIn(s) ?? (i > 0 ? periodIn(sentences[i - 1]) : null) ?? (i + 1 < sentences.length ? periodIn(sentences[i + 1]) : null);
    let score = 2;
    if (NEXUS_VOCAB.test(s)) score += 2;
    if (tx != null) score += 2;
    if (period) score += 1;
    if (/\$\s?\d/.test(s)) score += 1;
    if (/\b(?:more than|exceed|at least|or more|greater than)\b/i.test(s)) score += 1;
    const parse: ThresholdParse = { dollars: dollarsPick, transactions: tx, operator: operatorIn(s, dollarsPick, tx), period, quote: s.slice(0, 400), url };
    if (!best || score > best.score) best = { parse, score };
  }
  return best?.parse ?? null;
}

/** Seed vs page. Pure. */
export function compareWithSeed(parsed: ThresholdParse | null, seed: NexusThreshold): { matches_seed: boolean; differences: string[] } {
  if (!parsed) return { matches_seed: false, differences: ["nothing parsed"] };
  const diffs: string[] = [];
  if (parsed.dollars !== seed.dollars) diffs.push(`dollars ${fmt$(seed.dollars)} in the seed, ${fmt$(parsed.dollars)} on the page`);
  if (parsed.transactions !== seed.transactions) diffs.push(`transactions ${seed.transactions ?? "none"} in the seed, ${parsed.transactions ?? "none"} on the page`);
  if (parsed.transactions != null && seed.transactions != null && parsed.operator && seed.operator && parsed.operator !== seed.operator) diffs.push(`operator ${seed.operator} in the seed, ${parsed.operator} on the page`);
  if (parsed.period && parsed.period !== seed.period) diffs.push(`period ${seed.period.replace(/_/g, " ")} in the seed, ${parsed.period.replace(/_/g, " ")} on the page`);
  return { matches_seed: diffs.length === 0, differences: diffs };
}

function fmt$(v: number | null): string {
  return v == null ? "none" : `$${v.toLocaleString("en-US")}`;
}

export function verificationLine(v: NexusVerification, seed: NexusThreshold): string {
  const date = v.checked_at.slice(0, 10);
  if (!v.verified || !v.parsed) return `${seed.name}: seed value ${fmt$(seed.dollars)}${seed.transactions ? ` or ${seed.transactions} transactions` : ""}, not verified (${v.reason ?? "no threshold sentence found"}).`;
  const p = v.parsed;
  const parts = [fmt$(p.dollars)];
  if (p.transactions != null) parts.push(`${p.transactions} transactions`);
  const thr = parts.join(p.operator === "and" ? " and " : " or ");
  const period = p.period === "12_months" ? "over the prior 12 months" : p.period === "previous_or_current_year" ? "in the previous or current calendar year" : "";
  const dom = domainOf(p.url);
  return `${seed.name}: ${thr}${period ? ` ${period}` : ""}, verified ${date} from ${dom}${v.matches_seed ? ", matches the seed" : `, differs from the seed (${v.differences.join("; ")})`}.`;
}

export interface NexusCrawlDeps {
  map: TavilyModule["tavilyMap"];
  crawl: TavilyModule["tavilyCrawl"];
  extract: TavilyModule["tavilyExtract"];
}

async function defaultDeps(partial: Partial<NexusCrawlDeps>): Promise<NexusCrawlDeps> {
  if (partial.map && partial.crawl && partial.extract) return partial as NexusCrawlDeps;
  const mod = await import("./tavily.ts");
  return { map: partial.map ?? mod.tavilyMap, crawl: partial.crawl ?? mod.tavilyCrawl, extract: partial.extract ?? mod.tavilyExtract };
}

const MAP_INSTRUCTIONS = "Pages about remote sellers, economic nexus thresholds, marketplace facilitators, and out-of-state seller registration for sales and use tax";

/**
 * One jurisdiction: Map the revenue site, read the best pages, parse the
 * threshold. Falls back to Crawl of the seed URL, then to a plain Extract of it.
 */
export async function verifyStateThreshold(seed: NexusThreshold, meter?: Meter, deps: Partial<NexusCrawlDeps> = {}): Promise<NexusVerification> {
  const d = await defaultDeps(deps);
  const checked_at = new Date().toISOString();
  const base: Omit<NexusVerification, "line"> = { state: seed.state, verified: false, parsed: null, matches_seed: false, differences: [], sources: [], crawled: 0, extracted: 0, method: "none", reason: null, checked_at };
  const finish = (v: Omit<NexusVerification, "line">): NexusVerification => ({ ...v, line: verificationLine({ ...v, line: "" }, seed) });

  // 1. Map the site for candidate pages.
  let candidates: string[] = [];
  let method: NexusVerification["method"] = "none";
  try {
    const mapped = await d.map(`https://${seed.dor_domain}`, { instructions: MAP_INSTRUCTIONS, max_depth: 2, limit: 40 }, meter);
    base.crawled = mapped.results?.length ?? 0;
    candidates = pickCandidateUrls(mapped.results ?? [], seed, 3);
    if (candidates.length) method = "map+extract";
  } catch (err) {
    base.reason = `map failed: ${(err as Error).message.slice(0, 120)}`;
  }

  // 2. Nothing mapped: crawl from the seed URL and read the crawl text directly.
  let pages: Array<{ url: string; title: string; text: string }> = [];
  if (candidates.length === 0 || base.crawled === 0) {
    try {
      const crawled = await d.crawl(seed.source_url, { instructions: MAP_INSTRUCTIONS, max_depth: 1, limit: 10, chunks_per_source: 3 }, meter);
      const results = crawled.results ?? [];
      base.crawled = Math.max(base.crawled, results.length);
      const ranked = pickCandidateUrls(results.map((r) => r.url), seed, 3);
      pages = results.filter((r) => ranked.includes(r.url) && r.raw_content).map((r) => ({ url: r.url, title: domainOf(r.url), text: r.raw_content }));
      if (pages.length) method = "crawl";
    } catch (err) {
      base.reason = [base.reason, `crawl failed: ${(err as Error).message.slice(0, 120)}`].filter(Boolean).join("; ");
    }
    if (pages.length === 0 && candidates.length === 0) candidates = [seed.source_url];
  }

  // 3. Read the candidate pages.
  if (pages.length === 0 && candidates.length) {
    try {
      const ex = await d.extract(candidates, { extract_depth: "basic", format: "text" }, meter);
      pages = ex.results.filter((r) => r.raw_content).map((r) => ({ url: r.url, title: r.title ?? domainOf(r.url), text: r.raw_content }));
      if (method === "none") method = "extract";
      if (ex.failed_results?.length) base.reason = [base.reason, `${ex.failed_results.length} page${ex.failed_results.length === 1 ? "" : "s"} could not be read`].filter(Boolean).join("; ");
    } catch (err) {
      base.reason = [base.reason, `extract failed: ${(err as Error).message.slice(0, 120)}`].filter(Boolean).join("; ");
    }
  }
  base.extracted = pages.length;
  base.sources = pages.map((p) => ({ url: p.url, title: p.title }));
  base.method = method;

  // 4. Parse. Prefer the seed URL's page, then the first page that states a threshold.
  const ordered = [...pages.filter((p) => p.url === seed.source_url), ...pages.filter((p) => p.url !== seed.source_url)];
  for (const p of ordered) {
    const parsed = parseThresholdFromText(p.text, p.url);
    if (parsed && parsed.dollars != null) {
      const cmp = compareWithSeed(parsed, seed);
      return finish({ ...base, verified: true, parsed, matches_seed: cmp.matches_seed, differences: cmp.differences, reason: base.reason });
    }
  }
  return finish({ ...base, verified: false, parsed: null, reason: base.reason ?? (pages.length ? "no sentence on the pages states a dollar threshold" : "no page could be read") });
}
