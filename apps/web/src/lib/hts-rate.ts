// Reads the general duty rate for a tariff heading from the official
// Harmonized Tariff Schedule (hts.usitc.gov) with Tavily Extract and a
// deterministic parser. No model. The USITC site exposes a JSON search endpoint
// (reststop/search) and an HTML view; the parser accepts either shape and
// returns every number with the line it came from.

import type { Meter } from "./schemas";
type TavilyModule = typeof import("./tavily.ts");

export interface HtsRateRow {
  htsno: string;
  description: string;
  general: string | null;
  general_pct: number | null;
  special: string | null;
  column2: string | null;
  quote: string;
}

export interface HtsRateResult {
  heading: string;
  detail: string | null;
  url: string | null;
  read_at: string;
  label: string;
  description: string | null;
  general: string | null;
  general_pct: number | null;
  special: string | null;
  column2: string | null;
  rows: HtsRateRow[];
  quote: string | null;
  verified: boolean;
  reason: string | null;
}

/** Pages Tavily should read for a heading, most structured first. */
export function htsUrlsFor(heading4: string, detail?: string | null): string[] {
  const h = heading4.replace(/\D/g, "").slice(0, 4);
  const d = detail ? detail.replace(/[^\d.]/g, "") : null;
  const urls = [`https://hts.usitc.gov/reststop/search?keyword=${d ?? h}`];
  if (d && d !== h) urls.push(`https://hts.usitc.gov/reststop/search?keyword=${h}`);
  urls.push(`https://hts.usitc.gov/search?query=${h}`);
  return Array.from(new Set(urls));
}

export function normalizeHtsNo(v: string): string {
  return v.replace(/[^\d]/g, "");
}

const RATE_TOKEN = /\b(Free|\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s?¢\/(?:kg|liter|l|doz\.?|No\.|each|m2|m3|kg \+ \d+(?:\.\d+)?%)(?:\s*\+\s*\d+(?:\.\d+)?%)?|\$\d+(?:\.\d+)?\/(?:kg|liter|doz\.?|each|No\.)(?:\s*\+\s*\d+(?:\.\d+)?%)?)/g;

/** "3.9%" to 3.9, "Free" to 0, compound or specific rates to null. */
export function ratePct(rate: string | null | undefined): number | null {
  if (!rate) return null;
  const t = rate.trim();
  if (/^free$/i.test(t)) return 0;
  const m = t.match(/^(\d+(?:\.\d+)?)%$/);
  return m ? Number(m[1]) : null;
}

interface JsonRow {
  htsno?: string;
  description?: string;
  general?: string;
  special?: string;
  other?: string;
  indent?: string | number;
}

function fromJson(text: string, heading: string): { rows: HtsRateRow[]; description: string | null } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const arr = Array.isArray(data) ? data : Array.isArray((data as { results?: unknown }).results) ? (data as { results: unknown[] }).results : null;
  if (!arr) return null;
  const rows: HtsRateRow[] = [];
  let description: string | null = null;
  for (const raw of arr as JsonRow[]) {
    const no = typeof raw?.htsno === "string" ? raw.htsno.trim() : "";
    if (!no || !normalizeHtsNo(no).startsWith(heading)) continue;
    const desc = (raw.description ?? "").replace(/\s+/g, " ").trim();
    if (normalizeHtsNo(no) === heading && description === null) description = desc || null;
    const general = raw.general?.trim() || null;
    if (!general) continue;
    rows.push({ htsno: no, description: desc, general, general_pct: ratePct(general), special: raw.special?.trim() || null, column2: raw.other?.trim() || null, quote: `${no} ${desc} | ${general} | ${raw.special ?? ""} | ${raw.other ?? ""}`.replace(/\s+/g, " ").trim() });
  }
  return { rows, description };
}

function fromText(text: string, heading: string): { rows: HtsRateRow[]; description: string | null } {
  const rows: HtsRateRow[] = [];
  let description: string | null = null;
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^\|?\s*(\d{4}(?:\.\d{2}){0,3})\b\s*(?:\d{2}\b)?\s*[|:]?\s*(.*)$/);
    if (!m) continue;
    const no = m[1];
    if (!normalizeHtsNo(no).startsWith(heading)) continue;
    const rest = m[2];
    // Drop empty cells and the two-digit statistical suffix before the description.
    let cells = rest.split("|").map((c) => c.trim());
    while (cells.length && (cells[0] === "" || /^\d{2}$/.test(cells[0]))) cells = cells.slice(1);
    const tokens = Array.from(rest.matchAll(RATE_TOKEN)).map((x) => x[1]);
    if (normalizeHtsNo(no) === heading && tokens.length === 0) {
      description ??= cells[0] || null;
      continue;
    }
    if (tokens.length === 0) continue;
    const desc = cells.find((c) => c && !new RegExp(RATE_TOKEN.source).test(c)) ?? "";
    const general = tokens[0];
    // The special column is a rate followed by program codes in parentheses.
    const specialMatch = rest.match(/(Free|\d+(?:\.\d+)?%)\s*\(([A-Z*,+ ]+)\)/);
    const special = specialMatch ? `${specialMatch[1]} (${specialMatch[2]})` : null;
    const column2 = tokens.length >= 2 ? tokens[tokens.length - 1] : null;
    rows.push({ htsno: no, description: desc, general, general_pct: ratePct(general), special, column2: column2 && column2 !== general ? column2 : tokens.length >= 3 ? column2 : null, quote: line.slice(0, 300) });
  }
  return { rows, description };
}

/**
 * Parses schedule text (JSON from reststop/search or a pipe or whitespace table)
 * for one heading. Picks the detail line when given, else the first rated line
 * under the heading. Pure.
 */
export function parseHtsRates(text: string, heading4: string, detail?: string | null, url: string | null = null): HtsRateResult {
  const heading = heading4.replace(/\D/g, "").slice(0, 4);
  const d = detail ? normalizeHtsNo(detail) : null;
  const read_at = new Date().toISOString();
  const parsed = fromJson(text, heading) ?? fromText(text, heading);
  const base: HtsRateResult = { heading, detail: detail ?? null, url, read_at, label: `read from hts.usitc.gov on ${read_at.slice(0, 10)}`, description: parsed.description, general: null, general_pct: null, special: null, column2: null, rows: parsed.rows, quote: null, verified: false, reason: null };
  if (parsed.rows.length === 0) return { ...base, reason: "no rated line found for this heading" };
  let pick = d ? parsed.rows.find((r) => normalizeHtsNo(r.htsno) === d) ?? parsed.rows.find((r) => normalizeHtsNo(r.htsno).startsWith(d)) ?? parsed.rows.find((r) => d.startsWith(normalizeHtsNo(r.htsno))) : null;
  const note = d && !pick ? `no line for ${detail}; showing the first rated line under ${heading}` : null;
  pick ??= parsed.rows[0];
  return { ...base, general: pick.general, general_pct: pick.general_pct, special: pick.special, column2: pick.column2, quote: pick.quote, verified: true, reason: note, description: parsed.description ?? (pick.description || null) };
}

/** Reads the schedule pages for a heading and returns the first page that parses. */
export async function fetchHtsRate(heading4: string, meter?: Meter, opts: { detail?: string | null; extract?: TavilyModule["tavilyExtract"] } = {}): Promise<HtsRateResult> {
  // Lazy import: tests inject a fake and never load the Tavily client module.
  const extract = opts.extract ?? (await import("./tavily.ts")).tavilyExtract;
  const urls = htsUrlsFor(heading4, opts.detail);
  let last: HtsRateResult | null = null;
  try {
    const ex = await extract(urls, { extract_depth: "basic", format: "text" }, meter);
    for (const u of urls) {
      const page = ex.results.find((r) => r.url === u) ?? ex.results.find((r) => r.url.startsWith(u.split("?")[0]));
      if (!page?.raw_content) continue;
      const r = parseHtsRates(page.raw_content, heading4, opts.detail, page.url);
      if (r.verified) return r;
      last = r;
    }
    const failed = ex.failed_results?.map((f) => f.url).filter((u) => urls.includes(u)) ?? [];
    return last ?? { ...parseHtsRates("", heading4, opts.detail, null), reason: failed.length ? `hts.usitc.gov pages could not be read (${failed.length})` : "no schedule page returned text" };
  } catch (err) {
    return { ...parseHtsRates("", heading4, opts.detail, null), reason: `extract failed: ${(err as Error).message.slice(0, 160)}` };
  }
}

/** One line for the UI. */
export function htsRateLine(r: HtsRateResult): string {
  if (!r.verified) return `General duty for heading ${r.heading} could not be read from hts.usitc.gov (${r.reason ?? "unknown"}).`;
  const what = r.description ? `${r.heading}, ${r.description}` : `heading ${r.heading}`;
  const line = r.detail && r.rows.some((x) => normalizeHtsNo(x.htsno) === normalizeHtsNo(r.detail!)) ? `line ${r.detail}` : `first rated line ${r.rows[0]?.htsno ?? ""}`.trim();
  return `${what}: general duty ${r.general}${r.column2 ? `, column 2 ${r.column2}` : ""} (${line}), ${r.label}.`;
}
