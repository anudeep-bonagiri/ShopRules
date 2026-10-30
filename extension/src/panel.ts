// The slide-in overlay: a compact product inspector in the Polaris idiom.
// Lives in a Shadow DOM host so site CSS cannot touch it, and talks to the
// API only through the background worker.
import { canonicalProductUrl } from "./extract";
import { pricingInputs, reprice, type PricingResult } from "../../apps/web/src/lib/pricing";
import type {
  AccountResponse,
  AccountSettings,
  Alert,
  BgRequest,
  BgResult,
  CheckResponse,
  CompareResponse,
  LookupResponse,
  Marketplace,
  PagePayload,
  PageProduct,
  PricePoint,
  PricePosition,
  Product,
  ProductDetailResponse,
  Rule,
  RuleFamily,
  Settings,
  Severity,
  WatchResponse,
} from "./types";

export type Send = <T>(message: BgRequest) => Promise<BgResult<T>>;

type Phase = "loading" | "ready" | "unconfigured" | "error";
type Busy = "watch" | "check" | "compare" | "reprice" | null;
type Tone = "success" | "critical" | "warning" | "info" | "neutral";

interface PanelState {
  page: PageProduct;
  marketplace: Marketplace;
  phase: Phase;
  error: string | null;
  actionError: string | null;
  notice: string | null;
  baseUrl: string;
  lookup: LookupResponse | null;
  detail: ProductDetailResponse | null;
  settings: AccountSettings;
  unitCostPct: string;
  busy: Busy;
  compare: CompareResponse | null;
  compareError: string | null;
  showHelp: boolean;
}

interface Marker {
  t: number;
  label: string;
}

// Margin math, mirroring apps/web/src/lib/economics.ts.
interface Economics {
  price: number;
  currency: string | null;
  base: number;
  marginPct: number;
  deltaKind: "tariff" | "cost" | null;
  delta: number;
  landed: number;
  costDelta: number;
  marginAfterPct: number;
  unitsPerWeek: number;
  pricing: PricingResult;
}

const HOST_ID = "shop-rules-host";
const UCP_KEY_PREFIX = "sr_ucp:";
const DEFAULT_UNIT_COST_PCT = 45;
const DEFAULT_UNITS_PER_WEEK = 20;
const MAX_COMPETITORS = 5;

const FAMILY_LABEL: Record<RuleFamily, string> = {
  tariff: "Tariff",
  safety: "Product safety",
  tax: "Sales tax",
  policy: "Marketplace policy",
};
const FAMILY_TONE: Record<RuleFamily, Tone> = { tariff: "warning", safety: "critical", tax: "info", policy: "neutral" };
const SEVERITY_TONE: Record<Severity, Tone> = { high: "critical", medium: "warning", low: "info" };
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const POSITION: Record<PricePosition, { label: string; tone: Tone }> = {
  below_market: { label: "Below market", tone: "success" },
  at_market: { label: "At market", tone: "info" },
  above_market: { label: "Above market", tone: "warning" },
  unknown: { label: "Position unknown", tone: "neutral" },
};
const MARKET_LABEL: Record<string, string> = { amazon: "Amazon", etsy: "Etsy", shopify: "Shopify", other: "Web" };
const ID_LABEL: Record<string, string> = { amazon: "ASIN", etsy: "Listing", shopify: "Handle" };
const REGION_BY_CURRENCY: Record<string, string> = { USD: "US", CAD: "CA", GBP: "UK", EUR: "EU", AUD: "AU", NZD: "NZ", INR: "IN", JPY: "JP" };

const LOGO_SVG =
  '<svg width="20" height="20" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#008060"/>' +
  '<path d="M14 5.5l7 2.7v5.3c0 4.4-3 8.4-7 9.5-4-1.1-7-5.1-7-9.5V8.2l7-2.7z" fill="#fff" opacity="0.95"/>' +
  '<path d="M10.6 14.2l2.3 2.3 4.6-4.8" stroke="#008060" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
const PLACEHOLDER_SVG =
  '<svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true"><path d="M14 5.5l7 2.7v5.3c0 4.4-3 8.4-7 9.5-4-1.1-7-5.1-7-9.5V8.2l7-2.7z" fill="#c9cccf"/></svg>';

const STYLES = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.sr-panel {
  position: fixed; top: 0; right: 0; width: 420px; max-width: 100vw; height: 100vh;
  display: flex; flex-direction: column;
  background: #f6f6f7; color: #202223;
  font-family: Inter, -apple-system, "Segoe UI", sans-serif; font-size: 13px; line-height: 18px;
  box-shadow: -8px 0 24px rgba(0,0,0,0.12);
  transform: translateX(100%); transition: transform 180ms ease-out;
  z-index: 2147483647; outline: none;
}
.sr-panel.is-open { transform: translateX(0); }
.sr-num { font-variant-numeric: tabular-nums; }
.sr-header { flex: none; background: #fff; border-bottom: 1px solid #e1e3e5; padding: 12px 16px; }
.sr-brand { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.sr-brand__name { font-weight: 700; font-size: 14px; color: #008060; flex: 1; }
.sr-close {
  width: 28px; height: 28px; border: 1px solid #e1e3e5; border-radius: 8px; background: #fff; color: #6d7175;
  cursor: pointer; font: inherit; font-size: 16px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
}
.sr-close:hover { background: #f6f6f7; color: #202223; }
.sr-product { display: flex; gap: 12px; align-items: flex-start; }
.sr-thumb {
  width: 56px; height: 56px; flex: none; border-radius: 8px; border: 1px solid #e1e3e5; background: #f6f6f7;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.sr-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sr-product__body { flex: 1; min-width: 0; }
.sr-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.sr-title {
  margin: 0 0 2px; font-size: 14px; font-weight: 600; line-height: 18px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.sr-category { color: #6d7175; font-size: 12px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-body { flex: 1; overflow-y: auto; padding: 12px 16px 0; }
.sr-card { background: #fff; border: 1px solid #e1e3e5; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }
.sr-card--critical { border-left: 3px solid #d72c0d; }
.sr-card--warning { border-left: 3px solid #b98900; }
.sr-card--success { border-left: 3px solid #008060; }
.sr-card--info { border-left: 3px solid #0070e0; }
.sr-card h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.sr-card p { margin: 0; }
.sr-muted { color: #6d7175; }
.sr-small { font-size: 12px; line-height: 16px; }
.sr-green { color: #008060; }
.sr-red { color: #d72c0d; }
.sr-inset { background: #f6f6f7; border-radius: 8px; padding: 10px 12px; }
.sr-kv { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 4px 0; }
.sr-kv__v { font-weight: 600; }
.sr-ucp { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; color: #6d7175; font-size: 12px; }
.sr-ucp input { width: 44px; padding: 2px 6px; border: 1px solid #c9cccf; border-radius: 6px; font: inherit; font-size: 12px; color: #202223; background: #fff; text-align: right; }
.sr-ucp input:focus { outline: 2px solid #0070e0; outline-offset: 1px; }
.sr-pill {
  display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; border: 1px solid transparent;
  font-size: 11px; font-weight: 600; line-height: 16px; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap;
}
.sr-pill--success { background: #ebf5f0; color: #008060; border-color: #aee9d1; }
.sr-pill--critical { background: #fff4f4; color: #d72c0d; border-color: #fed3d1; }
.sr-pill--warning { background: #fef7e6; color: #b98900; border-color: #ffe699; }
.sr-pill--info { background: #f0f7ff; color: #0070e0; border-color: #b4dbff; }
.sr-pill--neutral { background: #f6f6f7; color: #6d7175; border-color: #e1e3e5; }
.sr-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.sr-metric { background: #f6f6f7; border-radius: 8px; padding: 10px 12px; min-width: 0; }
.sr-metric__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; color: #6d7175; margin-bottom: 4px; }
.sr-metric__value { font-size: 24px; line-height: 28px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-metric__delta { font-size: 12px; line-height: 16px; margin-top: 2px; }
.sr-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: #e1e3e5; margin: 6px 0 2px; }
.sr-bar__keep { background: #008060; height: 100%; }
.sr-bar__lost { background: #d72c0d; height: 100%; }
.sr-alert__head { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.sr-alert__headline { font-weight: 600; margin: 0 0 4px; }
.sr-alert__action { margin: 10px 0 0; font-weight: 500; }
.sr-evidence { margin-top: 8px; }
.sr-evidence__bar { display: flex; height: 6px; border-radius: 3px; background: #e1e3e5; overflow: hidden; }
.sr-evidence__backed { background: #008060; height: 100%; }
.sr-evidence__rejected { background: #d72c0d; height: 100%; }
.sr-evidence__caption { color: #6d7175; font-size: 12px; line-height: 16px; margin-top: 4px; }
.sr-audit { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-top: 1px solid #f1f2f3; }
.sr-audit:first-child { border-top: 0; padding-top: 0; }
.sr-audit__body { flex: 1; min-width: 0; }
.sr-audit__title { font-weight: 500; }
.sr-audit__meta { color: #6d7175; font-size: 12px; line-height: 16px; }
.sr-reprice { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
.sr-reprice__big { font-size: 24px; line-height: 28px; font-weight: 700; }
.sr-reprice__delta { font-size: 16px; line-height: 20px; font-weight: 700; }
.sr-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 32px; padding: 6px 12px; border-radius: 8px; font: inherit; font-weight: 600; font-size: 13px;
  cursor: pointer; text-decoration: none; text-align: center; transition: background 120ms;
}
.sr-btn--primary { background: #008060; color: #fff; border: 1px solid #008060; }
.sr-btn--primary:hover { background: #006e52; }
.sr-btn--primary:active { background: #004c3f; }
.sr-btn--secondary { background: #fff; color: #202223; border: 1px solid #c9cccf; }
.sr-btn--secondary:hover { background: #f6f6f7; }
.sr-btn[disabled] { opacity: 0.55; cursor: default; }
.sr-btn--block { width: 100%; }
.sr-row { display: flex; gap: 8px; margin-bottom: 8px; }
.sr-row > * { flex: 1; }
.sr-link { color: #008060; text-decoration: none; font-weight: 500; }
.sr-link:hover { text-decoration: underline; }
.sr-banner { border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; display: flex; gap: 10px; align-items: flex-start; border: 1px solid transparent; }
.sr-banner p { flex: 1; margin: 0; }
.sr-banner--critical { background: #fff4f4; color: #d72c0d; border-color: #fed3d1; }
.sr-banner--success { background: #ebf5f0; color: #008060; border-color: #aee9d1; }
.sr-banner .sr-btn { min-height: 26px; padding: 2px 10px; }
.sr-spark { display: block; width: 100%; height: 56px; }
.sr-history__row { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; }
.sr-compare__row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid #f1f2f3; }
.sr-compare__title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-compare__price { font-weight: 600; white-space: nowrap; }
.sr-compare__head { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; }
.sr-steps { margin: 10px 0 0; padding-left: 18px; }
.sr-steps li { margin-bottom: 4px; }
.sr-footer { flex: none; padding: 10px 16px; border-top: 1px solid #e1e3e5; background: #f6f6f7; color: #6d7175; font-size: 12px; line-height: 16px; }
.sr-skel { height: 12px; border-radius: 6px; margin: 6px 0; background: #e1e3e5; background-image: linear-gradient(90deg, #e1e3e5 0%, #f6f6f7 50%, #e1e3e5 100%); background-size: 200% 100%; animation: sr-shimmer 1.2s ease-in-out infinite; }
.sr-skel--pill { width: 72px; height: 18px; border-radius: 999px; margin: 0; }
.sr-skel--btn { height: 32px; border-radius: 8px; margin: 0; }
@keyframes sr-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
`;

// Markup helpers

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function pill(tone: Tone, label: string): string {
  return `<span class="sr-pill sr-pill--${tone}">${esc(label)}</span>`;
}

function card(title: string | null, body: string, accent?: Tone): string {
  const cls = accent ? ` sr-card--${accent}` : "";
  return `<section class="sr-card${cls}">${title ? `<h3>${esc(title)}</h3>` : ""}${body}</section>`;
}

function skeleton(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `<div class="sr-skel" style="width:${90 - (i % 3) * 20}%"></div>`).join("");
}

function unavailable(): string {
  return '<p class="sr-muted">Not available until Shop Rules is reachable.</p>';
}

function money(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const code = currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

function signedMoney(value: number, currency: string | null): string {
  return `${value < 0 ? "-" : "+"}${money(Math.abs(value), currency)}`;
}

function fmtPct(value: number, signed = false): string {
  const text = `${value.toFixed(1)}%`;
  return signed && value > 0 ? `+${text}` : text;
}

function num(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(iso).toLocaleDateString();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function familyLabel(value: string): string {
  return FAMILY_LABEL[value as RuleFamily] ?? capitalize(value);
}

function familyTone(value: string): Tone {
  return FAMILY_TONE[value as RuleFamily] ?? "neutral";
}

function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function listingId(url: string, market: Marketplace): string | null {
  const pattern =
    market === "amazon" ? /\/dp\/([A-Z0-9]{10})/i : market === "etsy" ? /\/listing\/(\d+)/ : market === "shopify" ? /\/products\/([^/?#]+)/ : null;
  return pattern ? (url.match(pattern)?.[1] ?? null) : null;
}

function toPayload(page: PageProduct, marketplace: Marketplace): PagePayload {
  const payload: PagePayload = { marketplace };
  if (page.title) payload.title = page.title;
  if (page.price !== null) payload.price = page.price;
  if (page.currency) payload.currency = page.currency;
  if (page.description) payload.description = page.description;
  if (page.materials?.length) payload.materials = page.materials;
  if (page.image) payload.image = page.image;
  return payload;
}

// State readers

function currentProduct(s: PanelState): Product | null {
  return s.detail?.product ?? s.lookup?.product ?? null;
}

function currentPrice(s: PanelState): number | null {
  return s.page.price ?? currentProduct(s)?.price ?? null;
}

function currentCurrency(s: PanelState): string | null {
  return s.page.currency ?? currentProduct(s)?.currency ?? s.settings.currency ?? null;
}

function productUrl(s: PanelState): string {
  const product = s.detail?.product;
  return product ? `${s.baseUrl}/products/${encodeURIComponent(product.id)}` : `${s.baseUrl}/`;
}

function channelLabel(s: PanelState): string {
  const base = MARKET_LABEL[s.marketplace] ?? capitalize(s.marketplace);
  if (s.marketplace !== "shopify") return base;
  const region = REGION_BY_CURRENCY[(currentCurrency(s) ?? "").toUpperCase()];
  return region ? `${base} ${region}` : base;
}

function categoryLine(s: PanelState): string {
  const profile = currentProduct(s)?.profile;
  const parts: string[] = [];
  if (profile?.category) parts.push(profile.category);
  if (profile?.product_type && profile.product_type !== profile.category) parts.push(profile.product_type);
  const id = listingId(s.page.url, s.marketplace);
  if (id) parts.push(`${ID_LABEL[s.marketplace] ?? "Id"} ${id}`);
  if (parts.length === 0) parts.push(s.phase === "loading" ? "Loading..." : "Not classified yet");
  if (s.detail) {
    const checked = timeAgo(s.detail.product.last_checked_at);
    parts.push(checked ? `Checked ${checked}` : "Not checked yet");
  }
  return parts.join(" · ");
}

function openAlerts(detail: ProductDetailResponse): Alert[] {
  return detail.alerts
    .filter((a) => a.status === "new")
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || b.created_at.localeCompare(a.created_at));
}

function topAlert(detail: ProductDetailResponse | null): Alert | null {
  return detail ? (openAlerts(detail)[0] ?? null) : null;
}

// Same math as the web app: pricing.ts is bundled from apps/web. The result stored
// on the alert wins unless the seller typed a different unit cost in this panel.
function economics(s: PanelState, alert: Alert | null): Economics | null {
  const price = currentPrice(s);
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const localShare = num(s.unitCostPct);
  const sharePct = localShare ?? s.settings.unit_cost_pct ?? DEFAULT_UNIT_COST_PCT;
  const inputs = pricingInputs(
    { price },
    alert?.impact ?? null,
    { unit_cost_pct: Math.min(Math.max(sharePct, 1), 99), units_per_week: s.settings.units_per_week ?? DEFAULT_UNITS_PER_WEEK, target_margin_pct: s.settings.target_margin_pct ?? null },
  );
  if (!inputs) return null;
  const pricing = alert?.pricing && localShare === null && Math.abs(alert.pricing.old_cost - inputs.landed_cost) < 0.5 ? alert.pricing : reprice(inputs);
  const tariff = alert?.impact?.tariff_rate_change_pct;
  const estimated = alert?.impact?.estimated_cost_change_pct;
  const deltaKind: Economics["deltaKind"] = pricing.basis === "duty" ? "tariff" : pricing.basis === "cost" ? "cost" : null;
  const delta = deltaKind === "tariff" ? (tariff ?? 0) : deltaKind === "cost" ? (estimated ?? 0) : 0;
  return {
    price,
    currency: currentCurrency(s),
    base: pricing.old_cost,
    marginPct: pricing.old_margin_pct,
    deltaKind,
    delta,
    landed: pricing.new_cost,
    costDelta: pricing.cost_delta,
    marginAfterPct: pricing.new_margin_pct_if_unchanged,
    unitsPerWeek: inputs.units_per_week,
    pricing,
  };
}

// One marker per open alert, at its effective date when that parses, else when it was raised.
function alertMarkers(detail: ProductDetailResponse | null): Marker[] {
  if (!detail) return [];
  return openAlerts(detail).flatMap((a) => {
    const effective = Date.parse(a.impact?.effective_date ?? "");
    const t = Number.isFinite(effective) ? effective : Date.parse(a.created_at);
    return Number.isFinite(t) ? [{ t, label: `${familyLabel(a.family)}: ${a.headline}` }] : [];
  });
}

// Section renderers

function renderHeader(s: PanelState): string {
  const product = currentProduct(s);
  const title = s.page.title ?? product?.title ?? "Untitled product";
  const image = safeHref(s.page.image ?? product?.image_url);
  const thumb = image ? `<div class="sr-thumb"><img src="${esc(image)}" alt=""></div>` : `<div class="sr-thumb">${PLACEHOLDER_SVG}</div>`;
  let watched: string;
  if (s.phase === "loading") watched = '<span class="sr-skel sr-skel--pill"></span>';
  else if (s.lookup?.watched || s.detail) watched = pill("success", "Watched");
  else watched = pill("neutral", "Not watched");
  return `<header class="sr-header">
    <div class="sr-brand">${LOGO_SVG}<span class="sr-brand__name">Shop Rules</span>
      <button class="sr-close" data-action="close" aria-label="Close" title="Close (Esc)">&times;</button></div>
    <div class="sr-product">${thumb}<div class="sr-product__body">
      <div class="sr-pills">${pill("neutral", channelLabel(s))}${watched}</div>
      <h2 class="sr-title" title="${esc(title)}">${esc(title)}</h2>
      <div class="sr-category" title="${esc(categoryLine(s))}">${esc(categoryLine(s))}</div>
    </div></div>
  </header>`;
}

function renderPriceBlock(s: PanelState): string {
  if (s.phase === "loading") return card(null, skeleton(3));
  const eco = economics(s, null);
  if (!eco) return card("Price", '<p class="sr-muted">No price found on this page, so landed cost and margin cannot be estimated.</p>');
  const target = s.settings.target_margin_pct;
  const shown = s.unitCostPct || String(s.settings.unit_cost_pct ?? DEFAULT_UNIT_COST_PCT);
  const field = `<label class="sr-ucp"><input data-field="unitCostPct" type="text" inputmode="decimal" value="${esc(shown)}" aria-label="Unit cost as a percent of retail">% of retail</label>`;
  const targetNote = typeof target === "number" ? ` <span class="sr-muted sr-small">(target ${target}%)</span>` : "";
  return card(
    null,
    `<div class="sr-inset">
      <div class="sr-kv"><span>Retail price</span><span class="sr-kv__v sr-num">${esc(money(eco.price, eco.currency))}</span></div>
      <div class="sr-kv"><span>Landed cost (base)${field}</span><span class="sr-kv__v sr-num">${esc(money(eco.base, eco.currency))}</span></div>
      <div class="sr-kv"><span>Margin${targetNote}</span><span class="sr-kv__v sr-num sr-green">${esc(fmtPct(eco.marginPct))}</span></div>
    </div>`,
  );
}

function evidenceBar(a: Alert): string {
  const total = Math.max(a.proposed, a.backed + a.rejected, 1);
  const backed = (a.backed / total) * 100;
  const rejected = (a.rejected / total) * 100;
  return `<div class="sr-evidence"><div class="sr-evidence__bar"><span class="sr-evidence__backed" style="width:${backed}%"></span><span class="sr-evidence__rejected" style="width:${rejected}%"></span></div>
    <div class="sr-evidence__caption sr-num">${a.proposed} proposed, ${a.backed} backed, ${a.rejected} rejected</div></div>`;
}

function metric(label: string, value: string, delta: string, deltaClass = "sr-muted", extra = ""): string {
  return `<div class="sr-metric"><div class="sr-metric__label">${esc(label)}</div><div class="sr-metric__value sr-num" title="${esc(value)}">${esc(value)}</div>${extra}<div class="sr-metric__delta sr-num ${deltaClass}">${esc(delta)}</div></div>`;
}

function renderMetrics(eco: Economics, alert: Alert): string {
  const c = eco.currency;
  const changed = eco.deltaKind !== null && eco.delta !== 0;
  const up = eco.delta > 0;
  const costTone = up ? "sr-red" : "sr-green";
  const relevance = alert.relevance === "affects" ? "Affects this product" : "Might affect this product";
  let first: string;
  if (eco.deltaKind === "tariff") first = metric("Duty rate hike", fmtPct(eco.delta, true), up ? "Rate rises vs the previous rate" : "Rate falls vs the previous rate", costTone);
  else if (eco.deltaKind === "cost") first = metric("Est. cost change", fmtPct(eco.delta, true), "Estimated by the checker", costTone);
  else first = metric("Severity", capitalize(alert.severity), relevance);
  const landed = changed
    ? metric("Landed cost / unit", money(eco.landed, c), `${signedMoney(eco.costDelta, c)} vs ${money(eco.base, c)} base`, costTone)
    : metric("Landed cost / unit", money(eco.base, c), "No cost change on file");
  const keep = eco.marginPct > 0 ? Math.max(0, Math.min(100, (eco.marginAfterPct / eco.marginPct) * 100)) : 0;
  const bar = `<div class="sr-bar"><span class="sr-bar__keep" style="width:${keep.toFixed(1)}%"></span><span class="sr-bar__lost" style="width:${(100 - keep).toFixed(1)}%"></span></div>`;
  const shift = eco.marginAfterPct - eco.marginPct;
  const margin = metric(
    "Net margin",
    fmtPct(eco.marginAfterPct),
    changed ? `was ${fmtPct(eco.marginPct)} (${shift > 0 ? "+" : ""}${shift.toFixed(1)} pts)` : "Unchanged by this alert",
    changed && shift < 0 ? "sr-red" : "sr-muted",
    bar,
  );
  const weekly = -eco.costDelta * eco.unitsPerWeek;
  const drag = changed
    ? metric("Weekly profit drag", signedMoney(weekly, c), `${eco.unitsPerWeek} units/wk x ${money(Math.abs(eco.costDelta), c)}`, weekly < 0 ? "sr-red" : "sr-green")
    : metric("Weekly profit drag", money(0, c), `${eco.unitsPerWeek} units/wk, no cost change`);
  return `<div class="sr-metrics">${first}${landed}${margin}${drag}</div>`;
}

function renderTopAlert(s: PanelState): string {
  const title = "Top open alert";
  if (s.phase === "loading") return card(title, skeleton(4));
  if (s.phase === "error") return card(title, unavailable());
  if (!s.detail) return card(title, '<p class="sr-muted">Watch this product to get verified alerts with the duty, cost, and margin impact.</p>');
  const alert = topAlert(s.detail);
  if (!alert) {
    const checked = timeAgo(s.detail.product.last_checked_at);
    return card(title, `<p class="sr-muted">No open alerts.${checked ? ` Last checked ${esc(checked)}.` : ""}</p>`, "success");
  }
  const open = openAlerts(s.detail).length;
  const eco = economics(s, alert);
  const hts = s.detail.product.profile?.hts_candidates?.[0];
  const more = open - 1;
  const body = `
    <div class="sr-alert__head">${pill(SEVERITY_TONE[alert.severity] ?? "neutral", alert.severity)}${pill(familyTone(alert.family), familyLabel(alert.family))}${pill(alert.relevance === "affects" ? "critical" : "warning", alert.relevance === "affects" ? "Affects product" : "Might affect")}</div>
    <p class="sr-alert__headline">${esc(alert.headline)}</p>
    ${hts?.code ? `<p class="sr-muted sr-small sr-num">HS ${esc(hts.code)}${hts.description ? ` · ${esc(hts.description)}` : ""}</p>` : ""}
    ${evidenceBar(alert)}
    ${eco ? renderMetrics(eco, alert) : '<p class="sr-muted sr-small" style="margin-top:8px">No page price, so the cost impact cannot be computed.</p>'}
    ${alert.action?.title ? `<p class="sr-alert__action">${esc(alert.action.title)}</p>` : ""}
    ${more > 0 ? `<p class="sr-small" style="margin-top:6px"><a class="sr-link" href="${esc(productUrl(s))}" target="_blank" rel="noopener">${more} more open alert${more === 1 ? "" : "s"} in Shop Rules</a></p>` : ""}`;
  return card(open > 1 ? `${title} (1 of ${open})` : title, body, alert.severity === "high" ? "critical" : "warning");
}

function renderAuditRow(rule: Rule, alert: Alert | null): string {
  let status: string;
  let meta: string;
  if (alert) {
    status = pill("critical", "Action needed");
    meta = alert.headline;
  } else if (!rule.last_run_at) {
    status = pill("neutral", "Not checked yet");
    meta = "Runs on the next check";
  } else {
    status = pill("success", "Nothing new");
    meta = `Ran ${timeAgo(rule.last_run_at) ?? "recently"}`;
  }
  const domain = rule.include_domains?.[0] ?? "official sources";
  return `<div class="sr-audit"><div class="sr-audit__body">
    <div class="sr-audit__title">${esc(rule.title)}</div>
    <div class="sr-audit__meta">${pill(familyTone(rule.family), familyLabel(rule.family))} ${esc(meta)} · ${esc(domain)}</div>
  </div>${status}</div>`;
}

function renderAudit(s: PanelState): string {
  const title = "Compliance audit";
  if (s.phase === "loading") return card(title, skeleton(3));
  if (s.phase === "error") return card(title, unavailable());
  if (!s.detail) {
    const preview = s.lookup?.families_preview ?? [];
    const pills = preview.length ? `<div class="sr-pills">${preview.map((f) => pill(familyTone(f), familyLabel(f))).join("")}</div>` : "";
    const lead = preview.length ? "These rule families are likely to touch this product. " : "";
    return card(title, `${pills}<p class="sr-muted">${lead}Watch this product to run the audit against official sources.</p>`);
  }
  const byRule = new Map<string, Alert>();
  for (const a of openAlerts(s.detail)) if (!byRule.has(a.rule_id)) byRule.set(a.rule_id, a);
  const audited = s.detail.rules.filter((r) => r.family === "safety" || r.family === "policy");
  const others = s.detail.rules.length - audited.length;
  const rows = audited.map((rule) => renderAuditRow(rule, byRule.get(rule.id) ?? null)).join("");
  const body = rows || '<p class="sr-muted">No safety or marketplace policy rules seeded for this product.</p>';
  const note = others > 0 ? `<p class="sr-muted sr-small" style="margin-top:8px">${others} tariff and sales-tax rule${others === 1 ? "" : "s"} run on their own schedule.</p>` : "";
  const needsAction = audited.some((r) => byRule.has(r.id));
  return card(title, body + note, needsAction ? "critical" : undefined);
}

function renderReprice(s: PanelState): string {
  if (s.phase !== "ready" || !s.detail) return "";
  const alert = topAlert(s.detail);
  const eco = alert ? economics(s, alert) : null;
  const suggested = eco?.pricing.suggested_price ?? null;
  if (!alert || !eco || suggested === null || !Number.isFinite(suggested)) return "";
  const c = currentCurrency(s);
  const delta = eco.pricing.suggested_delta;
  const preserved = eco.pricing.margin_at_suggested_pct;
  const label = s.busy === "reprice" ? "Copying..." : `Draft reprice (${money(suggested, c)})`;
  const right =
    delta !== null
      ? `<div style="text-align:right"><div class="sr-muted sr-small">Retail change</div><div class="sr-reprice__delta sr-num">${esc(signedMoney(delta, c))}</div>${preserved !== null ? `<div class="sr-muted sr-small sr-num">holds ${esc(fmtPct(preserved))} margin</div>` : ""}</div>`
      : "";
  return card(
    "Recommended reprice",
    `<div class="sr-reprice"><div><div class="sr-muted sr-small">Adjust to</div><div class="sr-reprice__big sr-num">${esc(money(suggested, c))}</div></div>${right}</div>
    <p class="sr-muted sr-small" style="margin-top:8px">${esc(eco.pricing.explanation)}</p>
    <button class="sr-btn sr-btn--primary sr-btn--block" data-action="reprice" style="margin-top:10px" ${s.busy ? "disabled" : ""}>${esc(label)}</button>
    <p class="sr-muted sr-small" style="margin-top:6px">Copies the new price to your clipboard and marks this alert actioned.</p>`,
    "success",
  );
}

function renderActions(s: PanelState): string {
  if (s.phase === "loading") {
    return '<div class="sr-row"><span class="sr-skel sr-skel--btn"></span><span class="sr-skel sr-skel--btn"></span></div>';
  }
  const watched = Boolean(s.detail);
  const disabled = s.busy || s.phase === "error" ? "disabled" : "";
  let label: string;
  if (watched) label = s.busy === "check" ? "Checking..." : "Run check now";
  else label = s.busy === "watch" ? "Adding..." : "Add to watchlist";
  const primary = `<button class="sr-btn ${watched ? "sr-btn--secondary" : "sr-btn--primary"}" data-action="${watched ? "check" : "watch"}" ${disabled}>${label}</button>`;
  const exportButton = '<button class="sr-btn sr-btn--secondary" data-action="export">Export dossier</button>';
  const open = `<p class="sr-small" style="margin:0 0 12px"><a class="sr-link" href="${esc(productUrl(s))}" target="_blank" rel="noopener">${watched ? "Open in Shop Rules" : "Open Shop Rules"}</a></p>`;
  return `<div class="sr-row">${primary}${exportButton}</div>${open}`;
}

function sparkline(points: PricePoint[], markers: Marker[]): string {
  const w = 360;
  const h = 56;
  const pad = 6;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const times = points.map((p) => Date.parse(p.at));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const timeBased = Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0;
  const xAt = (t: number): number => pad + (w - pad * 2) * ((t - t0) / (t1 - t0));
  const coords = points.map((p, i) => {
    const x = timeBased ? xAt(times[i] ?? t0) : pad + ((w - pad * 2) * i) / (points.length - 1);
    return [x, pad + (h - pad * 2) * (1 - (p.price - min) / span)] as const;
  });
  const path = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const area = `${path} L${(last?.[0] ?? w).toFixed(1)} ${h - pad} L${pad} ${h - pad} Z`;
  const lines = timeBased
    ? markers
        .filter((m) => m.t >= t0 && m.t <= t1)
        .map((m) => {
          const x = xAt(m.t).toFixed(1);
          return `<line x1="${x}" x2="${x}" y1="2" y2="${h - 2}" stroke="#6d7175" stroke-width="1" stroke-dasharray="3 3"><title>${esc(m.label)}</title></line>`;
        })
        .join("")
    : "";
  return `<svg class="sr-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="#008060" opacity="0.08"/>
    ${lines}
    <path d="${path}" fill="none" stroke="#008060" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${last ? `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="#008060"/>` : ""}
  </svg>`;
}

function renderPriceHistory(s: PanelState): string {
  const title = "Price history";
  if (s.phase === "loading") return card(title, skeleton(2));
  const currency = currentCurrency(s);
  const current = currentPrice(s);
  const history = [...(s.detail?.price_history ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  const first = history[0];
  const last = history[history.length - 1];
  if (history.length < 2 || !first || !last) {
    const now = current !== null ? `<p><span class="sr-kv__v sr-num">${esc(money(current, currency))}</span></p>` : "";
    const line = s.detail ? "History starts now." : "History starts when you watch this product.";
    return card(title, `${now}<p class="sr-muted">${line}</p>`);
  }
  const latest = current ?? last.price;
  const change = first.price ? ((latest - first.price) / first.price) * 100 : 0;
  const direction = change < -0.05 ? "Down" : change > 0.05 ? "Up" : "Unchanged";
  const since = timeAgo(first.at);
  const changeLine =
    direction === "Unchanged"
      ? `Unchanged since watched${since ? ` (${esc(since)})` : ""}.`
      : `${direction} ${Math.abs(change).toFixed(1)}% since watched${since ? ` (${esc(since)})` : ""}, from ${esc(money(first.price, first.currency ?? currency))}.`;
  const markers = alertMarkers(s.detail);
  const inRange = markers.some((m) => m.t >= Date.parse(first.at) && m.t <= Date.parse(last.at));
  const low = Math.min(...history.map((p) => p.price));
  const high = Math.max(...history.map((p) => p.price));
  return card(
    title,
    `${sparkline(history, markers)}
    ${inRange ? '<p class="sr-muted sr-small">Dashed lines mark alert dates.</p>' : ""}
    <div class="sr-history__row sr-num"><span class="sr-muted sr-small">${history.length} points, low ${esc(money(low, currency))}, high ${esc(money(high, currency))}</span><span class="sr-kv__v">${esc(money(latest, currency))}</span></div>
    <p class="sr-small sr-num ${direction === "Down" ? "sr-red" : "sr-muted"}">${changeLine}</p>`,
  );
}

function renderCompare(s: PanelState): string {
  const title = "Compare";
  if (s.phase === "loading") return card(title, skeleton(2));
  if (s.phase === "error") return card(title, unavailable());
  const hasTitle = Boolean(s.page.title ?? s.detail?.product.title);
  const label = s.busy === "compare" ? "Searching..." : s.compare ? "Search again" : "Find competitor prices";
  const button = `<button class="sr-btn sr-btn--secondary sr-btn--block" data-action="compare" ${s.busy || !hasTitle ? "disabled" : ""}>${label}</button>`;
  const parts = [button];
  if (!hasTitle) parts.push('<p class="sr-muted sr-small" style="margin-top:8px">No product title found on this page.</p>');
  if (s.compareError) parts.push(`<div class="sr-banner sr-banner--critical" style="margin:10px 0 0"><p>${esc(s.compareError)}</p></div>`);
  if (s.compare) {
    const position = POSITION[s.compare.price_position] ?? POSITION.unknown;
    parts.push(`<div class="sr-compare__head">${pill(position.tone, position.label)}<span class="sr-muted sr-small">${esc(s.compare.note)}</span></div>`);
    // The search sometimes returns this very listing; that is not a competitor.
    const listings = s.compare.listings.filter((l) => canonicalProductUrl(l.url, s.marketplace) !== s.page.url);
    const hidden = s.compare.listings.length - listings.length;
    const rows = listings.slice(0, MAX_COMPETITORS).map((l) => {
      const href = safeHref(l.url);
      const link = href ? `<a class="sr-link sr-small" href="${esc(href)}" target="_blank" rel="noopener">Open</a>` : "";
      const market = MARKET_LABEL[l.marketplace.toLowerCase()] ?? capitalize(l.marketplace);
      return `<div class="sr-compare__row">${pill("neutral", market)}<span class="sr-compare__title" title="${esc(l.title)}">${esc(l.title)}</span><span class="sr-compare__price sr-num">${esc(money(l.price, l.currency))}</span>${link}</div>`;
    });
    const empty = `No comparable listings found.${hidden ? ` ${hidden} result${hidden === 1 ? "" : "s"} matched this listing itself and ${hidden === 1 ? "was" : "were"} hidden.` : ""}`;
    parts.push(rows.join("") || `<p class="sr-muted" style="margin-top:8px">${empty}</p>`);
  }
  return card(title, parts.join(""));
}

function renderConnect(s: PanelState): string {
  const steps = s.showHelp
    ? `<ol class="sr-steps">
        <li>Click the Shop Rules icon in the Chrome toolbar. If it is hidden, open the puzzle-piece menu and pin it.</li>
        <li>In the Shop Rules web app, open Settings and copy the account token (it starts with <code>sr_live_</code>).</li>
        <li>Paste the token and the app URL into the popup, click Save, then reopen this panel.</li>
      </ol>`
    : "";
  return card(
    "Connect your Shop Rules account",
    `<p class="sr-muted" style="margin-bottom:10px">Paste your account token into the extension popup to see the rules, alerts, and price history for this product.</p>
    <button class="sr-btn sr-btn--primary" data-action="help">${s.showHelp ? "Open the popup" : "Show me how"}</button>${steps}`,
    "info",
  );
}

function renderBanners(s: PanelState): string {
  const out: string[] = [];
  if (s.phase === "error" && s.error) {
    out.push(`<div class="sr-banner sr-banner--critical"><p>${esc(s.error)}</p><button class="sr-btn sr-btn--secondary" data-action="retry">Retry</button></div>`);
  }
  if (s.actionError) {
    out.push(`<div class="sr-banner sr-banner--critical"><p>${esc(s.actionError)}</p><button class="sr-btn sr-btn--secondary" data-action="dismiss">Dismiss</button></div>`);
  }
  if (s.notice) {
    out.push(`<div class="sr-banner sr-banner--success"><p>${esc(s.notice)}</p><button class="sr-btn sr-btn--secondary" data-action="dismiss">Dismiss</button></div>`);
  }
  return out.join("");
}

function renderBody(s: PanelState): string {
  if (s.phase === "unconfigured") return renderBanners(s) + renderConnect(s);
  return (
    renderBanners(s) +
    renderPriceBlock(s) +
    renderTopAlert(s) +
    renderAudit(s) +
    renderReprice(s) +
    renderActions(s) +
    renderPriceHistory(s) +
    renderCompare(s)
  );
}

function renderFooter(): string {
  return '<footer class="sr-footer">Powered by Tavily and Nemotron on Nebius Token Factory</footer>';
}

// Clipboard and download helpers (content-script side effects)

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall through to the legacy path when the clipboard API is blocked.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Panel

export class Panel {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private panelEl: HTMLDivElement | null = null;
  private state: PanelState | null = null;
  private seq = 0;
  private closeTimer: number | null = null;
  private saveTimer = 0;
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.isOpen()) this.close();
  };

  constructor(
    private readonly send: Send,
    private readonly onToggle: (open: boolean) => void,
  ) {}

  isOpen(): boolean {
    return this.panelEl?.classList.contains("is-open") ?? false;
  }

  open(page: PageProduct, marketplace: Marketplace): void {
    this.mount();
    this.seq += 1;
    this.state = {
      page,
      marketplace,
      phase: "loading",
      error: null,
      actionError: null,
      notice: null,
      baseUrl: "",
      lookup: null,
      detail: null,
      settings: {},
      unitCostPct: "",
      busy: null,
      compare: null,
      compareError: null,
      showHelp: false,
    };
    this.render();
    const panel = this.panelEl;
    requestAnimationFrame(() => {
      panel?.classList.add("is-open");
      panel?.focus({ preventScroll: true });
    });
    this.onToggle(true);
    void this.load(this.seq);
    void this.loadUnitCost(this.seq);
  }

  close(): void {
    const panel = this.panelEl;
    if (!panel) return;
    panel.classList.remove("is-open");
    window.removeEventListener("keydown", this.onKeydown, true);
    this.onToggle(false);
    this.closeTimer = window.setTimeout(() => this.unmount(), 220);
  }

  private mount(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.host) {
      window.addEventListener("keydown", this.onKeydown, true);
      return;
    }
    const host = document.createElement("div");
    host.id = HOST_ID;
    const important: Record<string, string> = {
      all: "initial",
      position: "fixed",
      top: "0",
      right: "0",
      width: "0",
      height: "0",
      "z-index": "2147483647",
      display: "block",
    };
    for (const [prop, value] of Object.entries(important)) host.style.setProperty(prop, value, "important");
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    const panel = document.createElement("div");
    panel.className = "sr-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Shop Rules");
    panel.tabIndex = -1;
    panel.addEventListener("click", (event) => this.handleClick(event));
    panel.addEventListener("input", (event) => this.handleInput(event));
    root.append(style, panel);
    document.documentElement.appendChild(host);
    this.host = host;
    this.root = root;
    this.panelEl = panel;
    window.addEventListener("keydown", this.onKeydown, true);
  }

  private unmount(): void {
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.panelEl = null;
    this.state = null;
    this.closeTimer = null;
  }

  // Re-renders the whole panel but keeps the scroll position and the focused
  // input (with its caret) so typing in the unit cost field feels live.
  private render(): void {
    const panel = this.panelEl;
    const s = this.state;
    if (!panel || !s) return;
    const active = this.root?.activeElement;
    const field = active instanceof HTMLInputElement ? active.dataset.field : undefined;
    const caret = active instanceof HTMLInputElement ? active.selectionStart : null;
    const scrollTop = panel.querySelector(".sr-body")?.scrollTop ?? 0;
    panel.innerHTML = `${renderHeader(s)}<div class="sr-body">${renderBody(s)}</div>${renderFooter()}`;
    const body = panel.querySelector(".sr-body");
    if (body) body.scrollTop = scrollTop;
    if (field) {
      const input = panel.querySelector<HTMLInputElement>(`input[data-field="${field}"]`);
      if (input) {
        input.focus({ preventScroll: true });
        if (caret !== null) input.setSelectionRange(caret, caret);
      }
    }
  }

  private update(patch: Partial<PanelState>): void {
    if (!this.state) return;
    Object.assign(this.state, patch);
    this.render();
  }

  private handleClick(event: Event): void {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]") : null;
    if (!target) return;
    switch (target.dataset.action) {
      case "close":
        this.close();
        break;
      case "retry":
        this.update({ phase: "loading", error: null });
        void this.load(++this.seq);
        break;
      case "dismiss":
        this.update({ actionError: null, notice: null });
        break;
      case "watch":
        void this.watch();
        break;
      case "check":
        void this.check();
        break;
      case "compare":
        void this.compare();
        break;
      case "reprice":
        void this.reprice();
        break;
      case "export":
        this.exportDossier();
        break;
      case "help":
        this.update({ showHelp: true });
        void this.send({ type: "open-popup" });
        break;
      default:
        break;
    }
  }

  private handleInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.dataset.field !== "unitCostPct" || !this.state) return;
    this.update({ unitCostPct: input.value });
    this.saveUnitCost();
  }

  private saveUnitCost(): void {
    const s = this.state;
    if (!s) return;
    window.clearTimeout(this.saveTimer);
    const entry = { [`${UCP_KEY_PREFIX}${s.page.url}`]: s.unitCostPct };
    this.saveTimer = window.setTimeout(() => {
      try {
        void chrome.storage.local.set(entry).catch(() => undefined);
      } catch {
        // The extension context is gone (reloaded); nothing to save to.
      }
    }, 300);
  }

  private async loadUnitCost(seq: number): Promise<void> {
    const key = `${UCP_KEY_PREFIX}${this.state?.page.url ?? ""}`;
    let stored: Record<string, unknown>;
    try {
      stored = await chrome.storage.local.get(key);
    } catch {
      return;
    }
    const s = this.current(seq);
    const saved = stored[key];
    if (!s || (typeof saved !== "string" && typeof saved !== "number")) return;
    s.unitCostPct = String(saved);
    this.render();
  }

  // Data flow

  private current(seq: number): PanelState | null {
    return seq === this.seq ? this.state : null;
  }

  private async load(seq: number): Promise<void> {
    const settings = await this.send<Settings>({ type: "settings" });
    const s = this.current(seq);
    if (!s) return;
    if (!settings.ok) {
      this.update({ phase: "error", error: settings.error });
      return;
    }
    s.baseUrl = settings.data.baseUrl;
    if (!settings.data.token) {
      this.update({ phase: "unconfigured" });
      return;
    }
    const [lookup, account] = await Promise.all([
      this.send<LookupResponse>({ type: "lookup", url: s.page.url }),
      this.send<AccountResponse>({ type: "account" }),
    ]);
    if (!this.current(seq)) return;
    // Account settings are optional: defaults cover a missing or failing route.
    if (account.ok && account.data?.account?.settings && typeof account.data.account.settings === "object") {
      s.settings = account.data.account.settings;
    }
    if (!lookup.ok) {
      this.applyFailure(lookup.code, lookup.error);
      return;
    }
    s.lookup = lookup.data;
    if (lookup.data.watched && lookup.data.product) {
      await this.loadDetail(seq, lookup.data.product.id);
      return;
    }
    this.update({ phase: "ready" });
  }

  private async loadDetail(seq: number, id: string): Promise<void> {
    const detail = await this.send<ProductDetailResponse>({ type: "product", id });
    if (!this.current(seq)) return;
    if (!detail.ok) {
      this.applyFailure(detail.code, detail.error);
      return;
    }
    this.update({ phase: "ready", detail: detail.data, error: null });
  }

  private applyFailure(code: string, error: string): void {
    if (code === "unconfigured") this.update({ phase: "unconfigured" });
    else this.update({ phase: "error", error });
  }

  private async watch(): Promise<void> {
    const s = this.state;
    if (!s || s.busy) return;
    const seq = this.seq;
    this.update({ busy: "watch", actionError: null, notice: null });
    const result = await this.send<WatchResponse>({ type: "watch", url: s.page.url, page: toPayload(s.page, s.marketplace) });
    if (!this.current(seq)) return;
    if (!result.ok) {
      this.update({ busy: null, actionError: result.error });
      return;
    }
    const seeded = result.data.rules?.length ?? 0;
    const notice = result.data.existing ? "This product was already on your watchlist." : `Added to your watchlist. ${seeded} rule${seeded === 1 ? "" : "s"} seeded.`;
    const lookup: LookupResponse = { ...(s.lookup ?? { marketplace: s.marketplace, families_preview: [] }), watched: true, product: result.data.product };
    this.update({ busy: null, notice, lookup });
    await this.loadDetail(seq, result.data.product.id);
  }

  private async check(): Promise<void> {
    const s = this.state;
    const id = s?.detail?.product.id;
    if (!s || !id || s.busy) return;
    const seq = this.seq;
    this.update({ busy: "check", actionError: null, notice: null });
    const result = await this.send<CheckResponse>({ type: "check", id });
    if (!this.current(seq)) return;
    if (!result.ok) {
      this.update({ busy: null, actionError: result.error });
      return;
    }
    const found = result.data.alerts?.length ?? 0;
    const notice = `Check finished: ${result.data.checked} rule${result.data.checked === 1 ? "" : "s"} run, ${found} new alert${found === 1 ? "" : "s"}.`;
    this.update({ busy: null, notice });
    await this.loadDetail(seq, id);
  }

  private async compare(): Promise<void> {
    const s = this.state;
    if (!s || s.busy) return;
    const title = s.page.title ?? s.detail?.product.title;
    if (!title) return;
    const seq = this.seq;
    this.update({ busy: "compare", compareError: null });
    const price = currentPrice(s);
    const result = await this.send<CompareResponse>({
      type: "compare",
      body: { title, marketplace: s.marketplace, url: s.page.url, ...(price !== null ? { price } : {}) },
    });
    if (!this.current(seq)) return;
    if (!result.ok) {
      this.update({ busy: null, compareError: result.error });
      return;
    }
    this.update({ busy: null, compare: result.data });
  }

  // Copies the suggested price and marks the alert actioned on the server.
  private async reprice(): Promise<void> {
    const s = this.state;
    const alert = s ? topAlert(s.detail) : null;
    const suggested = s && alert ? (economics(s, alert)?.pricing.suggested_price ?? null) : null;
    if (!s || !alert || suggested === null || s.busy) return;
    const seq = this.seq;
    this.update({ busy: "reprice", actionError: null, notice: null });
    const text = suggested.toFixed(2);
    const copied = await copyText(text);
    const result = await this.send<unknown>({ type: "alertStatus", id: alert.id, status: "actioned" });
    if (!this.current(seq)) return;
    const copyNote = copied ? `Copied ${text} to the clipboard. ` : `Could not access the clipboard; the new price is ${text}. `;
    if (!result.ok) {
      this.update({ busy: null, actionError: `${copyNote}Marking the alert actioned failed: ${result.error}` });
      return;
    }
    this.update({ busy: null, notice: `${copyNote}Alert marked actioned. Paste the price into your listing editor.` });
    await this.loadDetail(seq, alert.product_id);
  }

  private exportDossier(): void {
    const s = this.state;
    if (!s) return;
    const product = currentProduct(s);
    const dossier = {
      exported_at: new Date().toISOString(),
      marketplace: s.marketplace,
      page: s.page,
      watched: Boolean(s.detail),
      product,
      rules: s.detail?.rules ?? [],
      alerts: s.detail?.alerts ?? [],
      price_history: s.detail?.price_history ?? [],
      skills: s.detail?.skills ?? [],
      competitors: s.compare,
      economics: economics(s, topAlert(s.detail)),
    };
    const id = product?.id ?? listingId(s.page.url, s.marketplace) ?? "product";
    downloadJson(`shop-rules-${id}-${new Date().toISOString().slice(0, 10)}.json`, dossier);
    this.update({ notice: "Dossier downloaded as JSON." });
  }
}
