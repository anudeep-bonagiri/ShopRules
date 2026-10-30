// Price tracking that actually happens. Three sources write points: the listing
// at ingest, the extension when a seller sees a watched page, and the daily
// refresh here (Tavily Extract or the Shopify .json endpoint, no model). A move
// past the seller's threshold raises a price_change alert whose numbers come
// from pricing.ts with a zero cost change.

import { insertAlert, insertPrice, listPrices, listProducts, touchProduct, type AccountRow, type AlertRow, type ProductRow } from "./db";
import { notifyTelegram } from "./pipeline";
import { pricingInputs, reprice } from "./pricing";
import { pricingProduct } from "./product";
import { changedByACent, isPlausibleMove, parsePriceFromContent, priceFromShopifyJson, type ParsedPrice } from "./price-parse";
import { tavilyExtract } from "./tavily";
import { newMeter } from "./schemas";

export const DEFAULT_PRICE_CHANGE_PCT = 3;

export interface Observation {
  price: number;
  currency: string | null;
  source: "extension" | "refresh" | "reprice" | "listing" | "check";
  /** How confident the parser was; text matches below 0.6 are not recorded unless there is no history. */
  confidence?: number;
}

export interface ObserveResult {
  inserted: boolean;
  reason: "recorded" | "unchanged" | "implausible" | "low_confidence";
  previous: number | null;
  alert: AlertRow | null;
}

function thresholdPct(account: AccountRow): number {
  const v = account.settings?.price_change_pct;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_PRICE_CHANGE_PCT;
}

/** Records one price point for a product when it is new information, and raises a price_change alert past the threshold. */
export async function observePrice(account: AccountRow, product: ProductRow, obs: Observation): Promise<ObserveResult> {
  const history = await listPrices(product.id, account.id);
  const last = history.length ? Number(history[history.length - 1].price) : null;
  const previous = Number.isFinite(last as number) ? (last as number) : null;
  if (!isPlausibleMove(previous, obs.price)) return { inserted: false, reason: "implausible", previous, alert: null };
  if (previous !== null && (obs.confidence ?? 1) < 0.6) return { inserted: false, reason: "low_confidence", previous, alert: null };
  if (!changedByACent(previous, obs.price)) return { inserted: false, reason: "unchanged", previous, alert: null };

  await insertPrice({ account_id: account.id, product_id: product.id, price: obs.price, currency: obs.currency ?? product.currency, source: obs.source });
  // The listing price the seller sees in the app follows the newest observation,
  // except for an extension read of a stale page cache (the server already knows better).
  if (obs.source !== "extension" || previous === null) await touchProduct(product.id, { price: obs.price, currency: obs.currency ?? product.currency ?? undefined }, account.id);

  let alert: AlertRow | null = null;
  if (previous !== null && obs.source !== "reprice") {
    const pct = ((obs.price - previous) / previous) * 100;
    if (Math.abs(pct) >= thresholdPct(account)) {
      alert = await raisePriceChangeAlert(account, { ...product, price: obs.price }, previous, obs.price, pct);
      await notifyTelegram(account, product, alert);
    }
  }
  return { inserted: true, reason: "recorded", previous, alert };
}

async function raisePriceChangeAlert(account: AccountRow, product: ProductRow, oldPrice: number, newPrice: number, pct: number): Promise<AlertRow> {
  const settings = account.settings ?? {};
  const inputs = pricingInputs(pricingProduct(product), { tariff_rate_change_pct: null, estimated_cost_change_pct: null }, settings);
  const pricing = inputs ? reprice(inputs) : null;
  const up = newPrice > oldPrice;
  const delta = Math.round((newPrice - oldPrice) * 100) / 100;
  const fmt = (v: number) => `$${v.toFixed(2)}`;
  const margin = pricing ? `${Math.round(pricing.old_margin_pct)}%` : "unknown";
  const headline = `${product.title.slice(0, 60)}${product.title.length > 60 ? "..." : ""} is now ${fmt(newPrice)}, ${up ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% from ${fmt(oldPrice)}`;
  const steps = up
    ? ["Confirm the new price is the one you set, not a sale ending or a variant switch", `Margin at ${fmt(newPrice)} is about ${margin} with your current unit cost`, "If a competitor forced it, run Compare to see where you sit"]
    : [`Check whether a sale or coupon is running on the listing`, `Margin at ${fmt(newPrice)} drops to about ${margin}; set your unit cost on the product to make this exact`, "Hold if intentional, otherwise restore the price in your store editor"];
  return insertAlert({
    account_id: account.id,
    product_id: product.id,
    rule_id: `price:${product.id}`,
    status: "new",
    family: "policy",
    kind: "price",
    severity: Math.abs(pct) >= 10 ? "high" : "medium",
    relevance: "affects",
    headline,
    claims: [],
    proposed: 0,
    backed: 0,
    rejected: 0,
    impact: { severity: Math.abs(pct) >= 10 ? "high" : "medium", effective_date: null, tariff_rate_change_pct: null, estimated_cost_change_pct: null },
    action: { type: "review", title: up ? "Confirm the price increase" : "Check why the price dropped", steps, suggested_price: null, rationale: `Listing price moved ${up ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% between two observations.` },
    pricing,
    price_change: { old_price: oldPrice, new_price: newPrice, delta, pct: Math.round(pct * 10) / 10 },
    sources: [{ url: product.url, title: product.title, domain: safeHost(product.url) }],
    dismiss_reason: null,
  });
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "listing";
  }
}

export function isShopifyUrl(url: string, marketplace: string): boolean {
  return marketplace === "shopify" || /\/products\/[^/?#]+/.test(url);
}

/** Fetches the current price of one listing without a model. */
export async function fetchListingPrice(product: Pick<ProductRow, "url" | "marketplace" | "price">, meter = newMeter()): Promise<ParsedPrice | null> {
  if (isShopifyUrl(product.url, product.marketplace)) {
    try {
      const u = new URL(product.url);
      u.search = "";
      u.hash = "";
      const res = await fetch(`${u.toString().replace(/\/$/, "")}.json`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
      if (res.ok) {
        const parsed = priceFromShopifyJson(await res.json());
        if (parsed) return parsed;
      }
    } catch {
      // fall through to Tavily
    }
  }
  try {
    const ex = await tavilyExtract([product.url], { extract_depth: "basic", format: "markdown" }, meter);
    const raw = ex.results?.[0]?.raw_content ?? "";
    return parsePriceFromContent(raw, { near: product.price ?? null });
  } catch {
    return null;
  }
}

export interface RefreshSummary {
  products: number;
  fetched: number;
  recorded: number;
  alerts: number;
  skipped: number;
  errors: number;
  partial: boolean;
}

/** Daily refresh for one account. No LLM calls. Stops at the time budget and reports partial. */
export async function refreshPrices(account: AccountRow, opts: { budgetMs?: number; started?: number; concurrency?: number } = {}): Promise<RefreshSummary> {
  const started = opts.started ?? Date.now();
  const budget = opts.budgetMs ?? 60_000;
  const summary: RefreshSummary = { products: 0, fetched: 0, recorded: 0, alerts: 0, skipped: 0, errors: 0, partial: false };
  const products = await listProducts(account.id);
  summary.products = products.length;
  const queue = [...products];
  const worker = async () => {
    while (queue.length) {
      if (Date.now() - started > budget) {
        summary.partial = true;
        return;
      }
      const product = queue.shift()!;
      try {
        const parsed = await fetchListingPrice(product);
        if (!parsed) {
          summary.skipped += 1;
          continue;
        }
        summary.fetched += 1;
        const r = await observePrice(account, product, { price: parsed.price, currency: parsed.currency ?? product.currency, source: "refresh", confidence: parsed.confidence });
        if (r.inserted) summary.recorded += 1;
        else summary.skipped += 1;
        if (r.alert) summary.alerts += 1;
      } catch (err) {
        summary.errors += 1;
        console.error("[shop-rules] price refresh failed", product.id, err instanceof Error ? err.message : err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 2, Math.max(queue.length, 1)) }, worker));
  return summary;
}
