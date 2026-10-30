// Hand-written CSV parsing and the two order exports a seller can download in
// one click (Shopify Orders, Etsy Orders). Only aggregates leave this file:
// per state, per calendar year, dollars and order counts. No order rows are stored.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

export type OrdersSource = "shopify" | "etsy";

export interface SalesAggregate {
  source: OrdersSource;
  /** year -> state code -> { dollars, orders } */
  by_year: Record<string, Record<string, { dollars: number; orders: number }>>;
  orders_seen: number;
  orders_skipped: number;
  years: number[];
  states: string[];
}

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const CODES = new Set(Object.values(US_STATES));

export function stateCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^[A-Za-z]{2}$/.test(s) && CODES.has(s.toUpperCase())) return s.toUpperCase();
  return US_STATES[s.toLowerCase()] ?? null;
}

function money(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function year(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})/);
  if (m) {
    const y = Number(m[1]);
    if (y >= 2000 && y <= 2100) return y;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).getUTCFullYear() : null;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Detects the export by its header row. */
export function detectOrdersSource(headers: string[]): OrdersSource | null {
  const h = new Set(headers.map(norm));
  if (h.has("shipping province") || h.has("shipping province name") || (h.has("financial status") && h.has("name"))) return "shopify";
  if (h.has("ship state") || h.has("order id") && h.has("sale date")) return "etsy";
  return null;
}

/**
 * Aggregates a Shopify Orders export (one line per line item; the order total
 * is on the first line of each order) or an Etsy Orders export (one line per
 * order) into dollars and order counts per ship-to state and calendar year.
 */
export function aggregateOrders(text: string, currentYear = new Date().getUTCFullYear()): SalesAggregate {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The file has no data rows.");
  const headers = rows[0].map(norm);
  const source = detectOrdersSource(rows[0]);
  if (!source) throw new Error("Not a Shopify Orders or Etsy Orders export. Shopify: Orders, Export. Etsy: Shop Manager, Settings, Options, Download Data, Orders.");
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(norm(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const by_year: SalesAggregate["by_year"] = {};
  let seen = 0;
  let skipped = 0;
  const bump = (y: number, st: string, dollars: number) => {
    const yk = String(y);
    by_year[yk] ??= {};
    by_year[yk][st] ??= { dollars: 0, orders: 0 };
    by_year[yk][st].dollars = Math.round((by_year[yk][st].dollars + dollars) * 100) / 100;
    by_year[yk][st].orders += 1;
  };
  if (source === "shopify") {
    const cName = col("name");
    const cDate = col("created at", "paid at");
    const cTotal = col("total", "subtotal");
    const cState = col("shipping province", "shipping province name", "billing province");
    const cStatus = col("financial status");
    const seenOrders = new Set<string>();
    for (const r of rows.slice(1)) {
      const name = r[cName] ?? "";
      const total = money(r[cTotal]);
      // Shopify repeats the order name on every line item; the totals sit on the first line.
      if (!name || seenOrders.has(name) || total == null) continue;
      seenOrders.add(name);
      seen += 1;
      const status = (r[cStatus] ?? "").toLowerCase();
      if (status && /refunded|voided/.test(status)) {
        skipped += 1;
        continue;
      }
      const y = year(r[cDate]);
      const st = stateCode(r[cState]);
      if (y == null || !st || y < currentYear - 1) {
        skipped += 1;
        continue;
      }
      bump(y, st, total);
    }
  } else {
    const cDate = col("sale date", "date paid", "order date");
    const cTotal = col("order total", "order value", "total");
    const cState = col("ship state");
    for (const r of rows.slice(1)) {
      seen += 1;
      const total = money(r[cTotal]);
      const y = year(r[cDate]);
      const st = stateCode(r[cState]);
      if (total == null || y == null || !st || y < currentYear - 1) {
        skipped += 1;
        continue;
      }
      bump(y, st, total);
    }
  }
  const years = Object.keys(by_year).map(Number).sort();
  const states = Array.from(new Set(Object.values(by_year).flatMap((m) => Object.keys(m)))).sort();
  return { source, by_year, orders_seen: seen, orders_skipped: skipped, years, states };
}
