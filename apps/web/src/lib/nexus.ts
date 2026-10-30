// Economic nexus: seed thresholds, the live-verified values an alert may carry,
// and the two-test progress math. Pure, no I/O, unit-tested.

import seed from "./nexus-thresholds.json" with { type: "json" };

export type NexusOperator = "or" | "and" | null;
export type NexusPeriod = "previous_or_current_year" | "12_months";

export interface NexusThreshold {
  state: string;
  name: string;
  dor_domain: string;
  source_url: string;
  dollars: number | null;
  transactions: number | null;
  operator: NexusOperator;
  period: NexusPeriod;
  marketplace_facilitator: boolean;
  note?: string;
}

/** What the Ultra decision may parse out of a verifier-backed quote. */
export interface NexusParsed {
  dollars: number | null;
  transactions: number | null;
  operator: NexusOperator;
}

const SEED = seed as { as_of: string; states: NexusThreshold[] };
export const NEXUS_AS_OF: string = SEED.as_of;
export const NEXUS_SEEDS: NexusThreshold[] = SEED.states;
const BY_STATE = new Map(NEXUS_SEEDS.map((s) => [s.state, s]));

export function nexusSeed(state: string | null | undefined): NexusThreshold | null {
  return state ? (BY_STATE.get(state.toUpperCase()) ?? null) : null;
}

export function describeThreshold(t: { dollars: number | null; transactions: number | null; operator: NexusOperator }): string {
  const parts: string[] = [];
  if (t.dollars != null) parts.push(`$${t.dollars.toLocaleString("en-US")}`);
  if (t.transactions != null) parts.push(`${t.transactions} transactions`);
  if (parts.length === 0) return "no threshold on file";
  if (parts.length === 1) return parts[0];
  return parts.join(t.operator === "and" ? " and " : " or ");
}

/** Dollar amounts in a text: "$500,000", "$100,000.00", "500,000 dollars". */
export function dollarsIn(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d{2})?|(\d{1,3}(?:,\d{3})+|\d{4,})\s+dollars/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(Number((m[1] ?? m[2]).replace(/,/g, "")));
  return out;
}

/** Transaction counts in a text: "200 transactions", "200 or more separate transactions", "100 sales". */
export function transactionsIn(text: string): number[] {
  const out: number[] = [];
  const re = /\b(\d{2,4})\s+(?:or more\s+)?(?:separate\s+|retail\s+)?(?:transactions|sales transactions|sales|orders)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(Number(m[1]));
  return out;
}

export interface NexusGuard {
  verified: boolean;
  parsed: NexusParsed | null;
  reason: string | null;
}

/**
 * The parsed nexus values count only when a verifier-backed quote states them.
 * Mirrors sanity.ts: numbers the quotes do not contain are dropped, never kept.
 */
export function guardNexusParse(parsed: NexusParsed | null | undefined, backedText: string): NexusGuard {
  if (!parsed || (parsed.dollars == null && parsed.transactions == null)) return { verified: false, parsed: null, reason: "no values parsed" };
  const dollars = dollarsIn(backedText);
  const txs = transactionsIn(backedText);
  const out: NexusParsed = { dollars: null, transactions: null, operator: parsed.operator ?? null };
  const dropped: string[] = [];
  if (parsed.dollars != null) {
    if (dollars.includes(parsed.dollars)) out.dollars = parsed.dollars;
    else dropped.push(`$${parsed.dollars.toLocaleString("en-US")}`);
  }
  if (parsed.transactions != null) {
    if (txs.includes(parsed.transactions)) out.transactions = parsed.transactions;
    else dropped.push(`${parsed.transactions} transactions`);
  }
  if (out.dollars == null && out.transactions == null) return { verified: false, parsed: null, reason: `no backed quote states ${dropped.join(" or ")}` };
  if (out.dollars != null && out.transactions != null) {
    // The quote decides the operator; the model's word is only kept when the text agrees.
    const lower = backedText.toLowerCase();
    const saysAnd = /\band\b/.test(lower) && !/\bor more\b|\bor\s+\d/.test(lower.replace(/or more/g, ""));
    out.operator = /\bor\b/.test(lower.replace(/or more/g, "")) ? "or" : saysAnd ? "and" : (parsed.operator ?? null);
  } else out.operator = null;
  return { verified: true, parsed: out, reason: dropped.length ? `${dropped.join(", ")} not in the quotes, dropped` : null };
}

export interface NexusProgressInput {
  threshold: { dollars: number | null; transactions: number | null; operator: NexusOperator };
  sales: number | null;
  transactions: number | null;
}

export interface NexusProgress {
  /** 0..100+ for the binding test, null when nothing to compare. */
  pct: number | null;
  binding: "dollars" | "transactions" | null;
  dollarsPct: number | null;
  transactionsPct: number | null;
  crossed: boolean;
  tone: "success" | "warning" | "critical";
  summary: string;
}

/**
 * Progress against both tests. With "or" the closer test binds; with "and" the
 * farther one does (both must be met); with a single test, that one.
 */
export function nexusProgress(i: NexusProgressInput): NexusProgress {
  const dPct = i.threshold.dollars != null && i.threshold.dollars > 0 && i.sales != null ? (i.sales / i.threshold.dollars) * 100 : null;
  const tPct = i.threshold.transactions != null && i.threshold.transactions > 0 && i.transactions != null ? (i.transactions / i.threshold.transactions) * 100 : null;
  let binding: NexusProgress["binding"] = null;
  let pct: number | null = null;
  if (dPct != null && tPct != null) {
    const pickMax = i.threshold.operator !== "and";
    binding = pickMax ? (dPct >= tPct ? "dollars" : "transactions") : dPct <= tPct ? "dollars" : "transactions";
    pct = binding === "dollars" ? dPct : tPct;
  } else if (dPct != null) {
    binding = "dollars";
    pct = dPct;
  } else if (tPct != null) {
    binding = "transactions";
    pct = tPct;
  }
  const crossed = i.threshold.operator === "and" ? (dPct ?? 0) >= 100 && (tPct ?? 0) >= 100 : (dPct ?? 0) >= 100 || (tPct ?? 0) >= 100;
  const tone: NexusProgress["tone"] = pct == null ? "success" : crossed || pct >= 100 ? "critical" : pct >= 80 ? "warning" : "success";
  let summary: string;
  if (pct == null) summary = "Add your sales to see how close you are";
  else if (crossed) summary = `Over the limit on ${binding === "dollars" ? "dollars" : "transactions"}`;
  else if (dPct != null && tPct != null) summary = `${Math.round(pct)}% of limit, ${binding === "dollars" ? "dollar" : "transaction"} test binds`;
  else summary = `${Math.round(pct)}% of limit`;
  return { pct, binding, dollarsPct: dPct, transactionsPct: tPct, crossed, tone, summary };
}

/** Which calendar years a period needs from the seller's imported sales. */
export function yearsFor(period: NexusPeriod, today = new Date()): number[] {
  const y = today.getUTCFullYear();
  return period === "12_months" ? [y, y - 1] : [y, y - 1];
}
