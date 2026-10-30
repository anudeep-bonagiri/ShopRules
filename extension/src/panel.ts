// The Product Stats HUD: a 420 px slide-in in a Shadow DOM host so site CSS
// cannot touch it. Talks to the API only through the background worker. Every
// dollar and percent comes from pricing.ts (bundled from apps/web) or stored
// data, never from model prose. Sections, top to bottom: header, stats row,
// rules that touch this product, top alert, compare, footer.
import { canonicalProductUrl } from "./extract";
import { pricingInputs, reprice, type PricingResult } from "../../apps/web/src/lib/pricing";
import { deltaSummary, filterRange, fmtDelta, sparklinePath, toChartPoints, type ChartPoint } from "../../apps/web/src/lib/chart";
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
  PricePosition,
  Product,
  ProductDetailResponse,
  Rule,
  RuleFamily,
  RunResponse,
  Settings,
  Severity,
  WatchResponse,
} from "./types";

export type Send = <T>(message: BgRequest) => Promise<BgResult<T>>;

type Phase = "loading" | "ready" | "unconfigured" | "auth" | "error";
type Busy = "watch" | "check" | "compare" | "reprice" | "dismiss" | "unitcost" | null;
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
  busy: Busy;
  compare: CompareResponse | null;
  compareError: string | null;
  showHelp: boolean;
  /** Text in the unit cost field while editing; null when not editing. */
  unitCostDraft: string | null;
  checkRun: RunResponse["run"] | null;
  ingestRun: RunResponse["run"] | null;
  dismissOpen: boolean;
  dismissReason: string;
}

// Margin view for the tiles and the alert card. Same math as the web app.
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
  unitCostSource: "product" | "default";
  pricing: PricingResult;
}

const HOST_ID = "shop-rules-host";
const DEFAULT_UNIT_COST_PCT = 45;
const DEFAULT_UNITS_PER_WEEK = 20;
const MAX_COMPETITORS = 5;
const POLL_MS = 2000;

const FAMILY_LABEL: Record<RuleFamily, string> = { tariff: "Tariffs", safety: "Safety", tax: "Sales tax", policy: "Policy" };
const FAMILY_ORDER: RuleFamily[] = ["tariff", "safety", "tax", "policy"];
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
const COUNTRY: Record<string, string> = { CN: "China", VN: "Vietnam", IN: "India", MX: "Mexico", CA: "Canada", US: "United States", TW: "Taiwan", KR: "South Korea", JP: "Japan", TH: "Thailand", ID: "Indonesia", BD: "Bangladesh", TR: "Turkey", IT: "Italy", DE: "Germany", PK: "Pakistan", KH: "Cambodia", MY: "Malaysia", PH: "Philippines", GB: "United Kingdom" };

const LOGO_SVG =
  '<svg width="20" height="20" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#008060"/>' +
  '<path d="M14 5.5l7 2.7v5.3c0 4.4-3 8.4-7 9.5-4-1.1-7-5.1-7-9.5V8.2l7-2.7z" fill="#fff" opacity="0.95"/>' +
  '<path d="M10.6 14.2l2.3 2.3 4.6-4.8" stroke="#008060" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
const PLACEHOLDER_SVG =
  '<svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true"><path d="M14 5.5l7 2.7v5.3c0 4.4-3 8.4-7 9.5-4-1.1-7-5.1-7-9.5V8.2l7-2.7z" fill="#c9cccf"/></svg>';

// Token sheet mirrors docs/design/DESIGN.md and apps/web/src/app/globals.css.
const STYLES = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.sr-panel {
  --sr-canvas: #f6f6f7; --sr-surface: #fff; --sr-inset: #f6f6f7; --sr-border: #e1e3e5; --sr-border-strong: #babfc3; --sr-border-input: #8c9196;
  --sr-text: #202223; --sr-text-2: #6d7175; --sr-primary: #008060; --sr-primary-hover: #006e52; --sr-mint: #ebf5f0; --sr-mint-border: #aee9d1;
  --sr-critical: #d72c0d; --sr-critical-bg: #fff4f4; --sr-critical-border: #fed3d1; --sr-warning: #b98900; --sr-warning-text: #8a6100; --sr-warning-bg: #fef7e6; --sr-warning-border: #ffe699;
  --sr-info: #0070e0; --sr-info-bg: #f0f7ff; --sr-info-border: #b4dbff;
  position: fixed; top: 0; right: 0; width: 420px; max-width: 100vw; height: 100vh; height: 100dvh;
  display: flex; flex-direction: column;
  background: var(--sr-canvas); color: var(--sr-text);
  font-family: Inter, -apple-system, "Segoe UI", sans-serif; font-size: 13px; line-height: 18px;
  box-shadow: -8px 0 24px rgba(0,0,0,0.12);
  transform: translateX(100%); transition: transform 180ms ease-out;
  z-index: 2147483647; outline: none;
}
@media (max-width: 600px) { .sr-panel { width: 100vw; } }
@media (prefers-reduced-motion: reduce) { .sr-panel { transition: none; } }
.sr-panel.is-open { transform: translateX(0); }
.sr-num { font-variant-numeric: tabular-nums; }
.sr-header { flex: none; background: var(--sr-surface); border-bottom: 1px solid var(--sr-border); padding: 12px 16px; }
.sr-brand { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.sr-brand__name { font-weight: 700; font-size: 14px; color: var(--sr-primary); flex: 1; }
.sr-close { width: 28px; height: 28px; border: 1px solid var(--sr-border); border-radius: 8px; background: var(--sr-surface); color: var(--sr-text-2); cursor: pointer; font: inherit; font-size: 16px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; }
.sr-close:hover { background: var(--sr-canvas); color: var(--sr-text); }
.sr-product { display: flex; gap: 12px; align-items: flex-start; }
.sr-thumb { width: 56px; height: 56px; flex: none; border-radius: 8px; border: 1px solid var(--sr-border); background: var(--sr-canvas); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.sr-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sr-product__body { flex: 1; min-width: 0; }
.sr-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.sr-title { margin: 0 0 2px; font-size: 14px; font-weight: 600; line-height: 18px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sr-category { color: var(--sr-text-2); font-size: 12px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-headprice { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.sr-headprice__v { font-size: 20px; line-height: 24px; font-weight: 700; }
.sr-watchrow { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.sr-body { flex: 1; overflow-y: auto; padding: 12px 16px 0; }
.sr-card { background: var(--sr-surface); border: 1px solid var(--sr-border); border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }
.sr-card--critical { border-left: 3px solid var(--sr-critical); }
.sr-card--warning { border-left: 3px solid var(--sr-warning); }
.sr-card--success { border-left: 3px solid var(--sr-primary); }
.sr-card--info { border-left: 3px solid var(--sr-info); }
.sr-card h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sr-card p { margin: 0; }
.sr-muted { color: var(--sr-text-2); }
.sr-small { font-size: 12px; line-height: 16px; }
.sr-green { color: var(--sr-primary); }
.sr-red { color: var(--sr-critical); }
.sr-inset { background: var(--sr-inset); border-radius: 8px; padding: 10px 12px; }
.sr-kv { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 4px 0; }
.sr-kv__v { font-weight: 600; }
.sr-pill { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px; border: 1px solid transparent; font-size: 11px; font-weight: 600; line-height: 16px; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; }
.sr-pill--lower { text-transform: none; letter-spacing: 0; }
.sr-pill--success { background: var(--sr-mint); color: var(--sr-primary); border-color: var(--sr-mint-border); }
.sr-pill--critical { background: var(--sr-critical-bg); color: var(--sr-critical); border-color: var(--sr-critical-border); }
.sr-pill--warning { background: var(--sr-warning-bg); color: var(--sr-warning-text); border-color: var(--sr-warning-border); }
.sr-pill--info { background: var(--sr-info-bg); color: var(--sr-info); border-color: var(--sr-info-border); }
.sr-pill--neutral { background: var(--sr-canvas); color: var(--sr-text-2); border-color: var(--sr-border); }
.sr-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; }
.sr-dot--live { animation: sr-pulse 1.2s ease-in-out infinite; }
@keyframes sr-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .sr-dot--live { animation: none; } }
.sr-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sr-tile { background: var(--sr-surface); border: 1px solid var(--sr-border); border-radius: 8px; padding: 10px 12px; min-width: 0; min-height: 92px; display: flex; flex-direction: column; gap: 2px; }
.sr-tile__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; color: var(--sr-text-2); }
.sr-tile__value { font-size: 22px; line-height: 26px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-tile__delta { font-size: 12px; line-height: 16px; color: var(--sr-text-2); }
.sr-tile__spark { display: block; width: 100%; height: 28px; margin-top: auto; }
.sr-tile__edit { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.sr-tile__edit input { width: 72px; padding: 3px 6px; border: 1px solid var(--sr-border-input); border-radius: 6px; font: inherit; font-size: 12px; color: var(--sr-text); background: var(--sr-surface); text-align: right; }
.sr-tile__edit input:focus { outline: 2px solid var(--sr-info); outline-offset: 1px; }
.sr-tile__edit .sr-btn { min-height: 24px; padding: 1px 8px; font-size: 12px; }
.sr-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.sr-metric { background: var(--sr-inset); border-radius: 8px; padding: 10px 12px; min-width: 0; }
.sr-metric__label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; color: var(--sr-text-2); margin-bottom: 4px; }
.sr-metric__value { font-size: 20px; line-height: 24px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sr-metric__delta { font-size: 12px; line-height: 16px; margin-top: 2px; }
.sr-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--sr-border); margin: 6px 0 2px; gap: 2px; }
.sr-bar__keep { background: var(--sr-primary); height: 100%; }
.sr-bar__lost { background: var(--sr-critical); height: 100%; }
.sr-alert__head { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.sr-alert__headline { font-weight: 600; margin: 0 0 4px; }
.sr-alert__action { margin: 10px 0 0; font-weight: 500; }
.sr-evidence { margin-top: 8px; }
.sr-evidence__bar { display: flex; height: 6px; border-radius: 3px; background: var(--sr-border); overflow: hidden; gap: 2px; }
.sr-evidence__backed { background: var(--sr-primary); height: 100%; }
.sr-evidence__rejected { background: var(--sr-critical); height: 100%; }
.sr-evidence__caption { color: var(--sr-text-2); font-size: 12px; line-height: 16px; margin-top: 4px; }
.sr-rulegroup { padding: 8px 0; border-top: 1px solid var(--sr-border); }
.sr-rulegroup:first-of-type { border-top: 0; padding-top: 0; }
.sr-rulegroup__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 600; margin-bottom: 4px; }
.sr-rule { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 4px 0; }
.sr-rule__title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-rule__meta { color: var(--sr-text-2); font-size: 12px; line-height: 16px; white-space: nowrap; }
.sr-progress { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: var(--sr-inset); font-size: 12px; line-height: 16px; color: var(--sr-text-2); }
.sr-progress__bar { height: 4px; border-radius: 2px; background: var(--sr-border); overflow: hidden; margin: 6px 0; }
.sr-progress__fill { height: 100%; background: var(--sr-primary); transition: width 200ms; }
.sr-steps { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.sr-reprice { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
.sr-reprice__big { font-size: 24px; line-height: 28px; font-weight: 700; }
.sr-reprice__delta { font-size: 16px; line-height: 20px; font-weight: 700; }
.sr-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 6px 12px; border-radius: 8px; font: inherit; font-weight: 600; font-size: 13px; cursor: pointer; text-decoration: none; text-align: center; transition: background 120ms; }
.sr-btn--primary { background: var(--sr-primary); color: #fff; border: 1px solid var(--sr-primary); }
.sr-btn--primary:hover { background: var(--sr-primary-hover); }
.sr-btn--secondary { background: var(--sr-surface); color: var(--sr-text); border: 1px solid #c9cccf; }
.sr-btn--secondary:hover { background: var(--sr-canvas); }
.sr-btn--plain { background: transparent; border: 1px solid transparent; color: var(--sr-primary); padding-left: 4px; padding-right: 4px; }
.sr-btn--plain:hover { text-decoration: underline; }
.sr-btn[disabled] { opacity: 0.55; cursor: default; }
.sr-btn--block { width: 100%; }
.sr-btn:focus-visible, .sr-close:focus-visible, .sr-link:focus-visible, textarea:focus-visible { outline: 2px solid var(--sr-info); outline-offset: 2px; }
.sr-row { display: flex; gap: 8px; margin-bottom: 8px; }
.sr-row > * { flex: 1; }
.sr-link { color: var(--sr-primary); text-decoration: none; font-weight: 500; }
.sr-link:hover { text-decoration: underline; }
.sr-banner { border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; display: flex; gap: 10px; align-items: flex-start; border: 1px solid transparent; }
.sr-banner p { flex: 1; margin: 0; }
.sr-banner--critical { background: var(--sr-critical-bg); color: var(--sr-critical); border-color: var(--sr-critical-border); }
.sr-banner--success { background: var(--sr-mint); color: var(--sr-primary); border-color: var(--sr-mint-border); }
.sr-banner .sr-btn { min-height: 26px; padding: 2px 10px; }
.sr-textarea { width: 100%; min-height: 64px; padding: 8px 10px; border: 1px solid var(--sr-border-input); border-radius: 8px; font: inherit; color: var(--sr-text); background: var(--sr-surface); resize: vertical; margin-top: 8px; }
.sr-compare__row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid #f1f2f3; }
.sr-compare__title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-compare__price { font-weight: 600; white-space: nowrap; }
.sr-compare__head { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; flex-wrap: wrap; }
.sr-helpsteps { margin: 10px 0 0; padding-left: 18px; }
.sr-helpsteps li { margin-bottom: 4px; }
.sr-footer { flex: none; padding: 10px 16px; border-top: 1px solid var(--sr-border); background: var(--sr-canvas); color: var(--sr-text-2); font-size: 12px; line-height: 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.sr-footer__links { display: flex; gap: 12px; align-items: center; }
.sr-skel { height: 12px; border-radius: 6px; margin: 6px 0; background: var(--sr-border); background-image: linear-gradient(90deg, var(--sr-border) 0%, var(--sr-canvas) 50%, var(--sr-border) 100%); background-size: 200% 100%; animation: sr-shimmer 1.2s ease-in-out infinite; }
.sr-skel--pill { width: 72px; height: 18px; border-radius: 999px; margin: 0; }
.sr-skel--btn { height: 32px; border-radius: 8px; margin: 0; }
@keyframes sr-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.sr-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
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

function pill(tone: Tone, label: string, opts: { dot?: boolean; live?: boolean; lower?: boolean } = {}): string {
  const dot = opts.dot || opts.live ? `<span class="sr-dot${opts.live ? " sr-dot--live" : ""}" aria-hidden="true"></span>` : "";
  return `<span class="sr-pill sr-pill--${tone}${opts.lower ? " sr-pill--lower" : ""}">${dot}${esc(label)}</span>`;
}

function card(title: string | null, body: string, accent?: Tone, aside = ""): string {
  const cls = accent ? ` sr-card--${accent}` : "";
  return `<section class="sr-card${cls}">${title ? `<h3><span>${esc(title)}</span>${aside}</h3>` : ""}${body}</section>`;
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
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(value);
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
  return days < 30 ? `${days} d ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Dates arrive as YYYY-MM-DD (a calendar day, shown as is) or as full ISO stamps (shown in local time).
function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dayOnly ? `${iso}T00:00:00Z` : iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...(dayOnly ? { timeZone: "UTC" } : {}) });
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

function newRunId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function toPayload(page: PageProduct, marketplace: Marketplace): PagePayload {
  const payload: PagePayload = { marketplace };
  if (page.title) payload.title = page.title;
  if (page.price !== null) payload.price = page.price;
  if (page.currency) payload.currency = page.currency;
  const description = [page.description, page.product_type ? `Product type: ${page.product_type}` : null, page.vendor ? `Vendor: ${page.vendor}` : null, page.tags?.length ? `Tags: ${page.tags.join(", ")}` : null].filter(Boolean).join("\n");
  if (description) payload.description = description.slice(0, 6000);
  if (page.materials?.length) payload.materials = page.materials;
  if (page.image) payload.image = page.image;
  return payload;
}

// State readers

function currentProduct(s: PanelState): Product | null {
  return s.detail?.product ?? s.lookup?.product ?? null;
}

function currentPrice(s: PanelState): number | null {
  const product = currentProduct(s);
  const override = product?.overrides?.price_override;
  if (typeof override === "number" && override > 0) return override;
  return s.page.price ?? product?.price ?? null;
}

function currentCurrency(s: PanelState): string | null {
  return s.page.currency ?? currentProduct(s)?.currency ?? s.settings.currency ?? null;
}

function productUrl(s: PanelState): string {
  const product = s.detail?.product;
  return product ? `${s.baseUrl}/products/${encodeURIComponent(product.id)}` : `${s.baseUrl}/`;
}

function channelLabel(s: PanelState): string {
  return MARKET_LABEL[s.marketplace] ?? capitalize(s.marketplace);
}

function priceNote(s: PanelState): string | null {
  const src = s.page.confidence?.price;
  if (s.page.price === null) return currentProduct(s)?.price != null ? "price from your watchlist" : null;
  if (src === "api") return "exact, from the store API";
  if (src === "json_ld" || src === "open_graph") return "from the page's product data";
  if (src === "selectors" || src === "card" || src === "text") return "read from page markup, verify";
  return null;
}

function openAlerts(detail: ProductDetailResponse | null): Alert[] {
  if (!detail) return [];
  return detail.alerts
    .filter((a) => a.status === "new")
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || b.created_at.localeCompare(a.created_at));
}

function topAlert(detail: ProductDetailResponse | null): Alert | null {
  return detail ? (openAlerts(detail)[0] ?? null) : null;
}

function openTariffAlert(detail: ProductDetailResponse | null): Alert | null {
  return openAlerts(detail).find((a) => a.family === "tariff" && a.kind !== "price" && a.impact?.tariff_rate_change_pct != null) ?? null;
}

// One implementation of the math: pricing.ts from apps/web. The result stored on
// the alert wins when it was computed from the same unit cost.
function economics(s: PanelState, alert: Alert | null): Economics | null {
  const price = currentPrice(s);
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  const product = currentProduct(s);
  const unitCost = product?.overrides?.unit_cost ?? null;
  const sharePct = s.settings.unit_cost_pct ?? DEFAULT_UNIT_COST_PCT;
  const inputs = pricingInputs(
    { price, unit_cost: unitCost, dutiable_share: product?.overrides?.dutiable_share ?? null, units_per_week: product?.overrides?.units_per_week ?? null },
    alert?.impact ?? null,
    { unit_cost_pct: Math.min(Math.max(sharePct, 1), 99), units_per_week: s.settings.units_per_week ?? DEFAULT_UNITS_PER_WEEK, target_margin_pct: s.settings.target_margin_pct ?? null, dutiable_share: s.settings.dutiable_share ?? null },
  );
  if (!inputs) return null;
  const stored = alert?.pricing && Math.abs(alert.pricing.old_cost - inputs.landed_cost) < 0.005 && Math.abs((alert.pricing.old_cost + alert.pricing.cost_delta) / (1 - alert.pricing.old_margin_pct / 100) - price / (1 - alert.pricing.old_margin_pct / 100)) < 1 ? alert.pricing : null;
  const pricing = stored ?? reprice(inputs);
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
    unitCostSource: unitCost != null ? "product" : "default",
    pricing,
  };
}

function historyPoints(s: PanelState): ChartPoint[] {
  return toChartPoints((s.detail?.price_history ?? []).map((p) => ({ at: p.at, price: p.price, source: p.source })));
}

// Section renderers

function renderHeader(s: PanelState): string {
  const product = currentProduct(s);
  const title = s.page.title ?? product?.title ?? "Untitled product";
  const image = safeHref(s.page.image ?? product?.image_url);
  const thumb = image ? `<div class="sr-thumb"><img src="${esc(image)}" alt=""></div>` : `<div class="sr-thumb">${PLACEHOLDER_SVG}</div>`;
  const price = currentPrice(s);
  const note = priceNote(s);
  const id = listingId(s.page.url, s.marketplace);
  const sub = [product?.profile?.category, product?.profile?.product_type && product.profile.product_type !== product.profile.category ? product.profile.product_type : null, id ? `${ID_LABEL[s.marketplace] ?? "Id"} ${id}` : null]
    .filter(Boolean)
    .join(" · ");

  let watchRow = "";
  if (s.phase === "loading") watchRow = '<span class="sr-skel sr-skel--pill"></span>';
  else if (s.detail) {
    const since = fmtDate(s.detail.product.created_at);
    watchRow = pill("success", since ? `Watching since ${since}` : "Watching", { dot: true, lower: true });
  } else if (s.phase === "ready") {
    const label = s.busy === "watch" ? "Adding..." : "Watch this product";
    watchRow = `<button class="sr-btn sr-btn--primary" data-action="watch" ${s.busy ? "disabled" : ""}>${label}</button><span class="sr-muted sr-small">Saves it to your watchlist and seeds its rules. You get notified when its price or its rules change.</span>`;
  }
  const ingest = s.ingestRun ? renderIngestProgress(s.ingestRun) : "";

  return `<header class="sr-header">
    <div class="sr-brand">${LOGO_SVG}<span class="sr-brand__name">Shop Rules</span>
      <button class="sr-close" data-action="close" aria-label="Close" title="Close (Esc)">&times;</button></div>
    <div class="sr-product">${thumb}<div class="sr-product__body">
      <div class="sr-pills">${pill("neutral", channelLabel(s))}${product?.profile?.origin_country ? pill("neutral", `From ${COUNTRY[product.profile.origin_country.toUpperCase()] ?? product.profile.origin_country}`, { lower: true }) : ""}</div>
      <h2 class="sr-title" id="sr-title" title="${esc(title)}">${esc(title)}</h2>
      ${sub ? `<div class="sr-category" title="${esc(sub)}">${esc(sub)}</div>` : ""}
      <div class="sr-headprice">${price !== null ? `<span class="sr-headprice__v sr-num">${esc(money(price, currentCurrency(s)))}</span>` : '<span class="sr-muted">No price found on this page</span>'}${note ? `<span class="sr-muted sr-small">${esc(note)}</span>` : ""}</div>
    </div></div>
    <div class="sr-watchrow">${watchRow}</div>${ingest}
  </header>`;
}

function renderIngestProgress(run: RunResponse["run"]): string {
  const steps = run.steps ?? [];
  const pills = steps
    .map((st, i) => {
      const tone: Tone = st.status === "done" ? "success" : st.status === "active" ? "info" : st.status === "error" ? "critical" : "neutral";
      return pill(tone, `${i + 1}. ${st.label}`, { dot: st.status !== "active", live: st.status === "active", lower: true });
    })
    .join("");
  const line = run.status === "failed" ? `<p class="sr-red sr-small" style="margin-top:6px">${esc(run.error ?? "The listing could not be read.")}</p>` : "";
  return `<div class="sr-steps" role="status" aria-live="polite">${pills}</div>${line}`;
}

function tile(label: string, value: string, delta: string, deltaClass = "", extra = ""): string {
  return `<div class="sr-tile"><div class="sr-tile__label">${esc(label)}</div><div class="sr-tile__value" title="${esc(value)}">${esc(value)}</div>${delta ? `<div class="sr-tile__delta ${deltaClass}">${delta}</div>` : ""}${extra}</div>`;
}

function sparkline(points: ChartPoint[], up: boolean): string {
  const w = 160;
  const h = 28;
  const { path, last } = sparklinePath(points, w, h, 3);
  if (!path) return "";
  const color = up ? "var(--sr-primary)" : "var(--sr-critical)";
  return `<svg class="sr-tile__spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${last ? `<circle cx="${last.x}" cy="${last.y}" r="4" fill="var(--sr-surface)"/><circle cx="${last.x}" cy="${last.y}" r="2.5" fill="${color}"/>` : ""}</svg>`;
}

function renderStats(s: PanelState): string {
  if (s.phase === "loading") return `<div class="sr-tiles">${[0, 1, 2, 3].map(() => `<div class="sr-tile">${skeleton(2)}</div>`).join("")}</div>`;
  if (s.phase === "error") return card("Stats", unavailable());
  const c = currentCurrency(s);
  const price = currentPrice(s);
  const tariff = openTariffAlert(s.detail);
  const eco = economics(s, tariff);
  const product = currentProduct(s);

  // 1. Current price: delta vs first seen and a 30 day sparkline once there is more than one point.
  const history = historyPoints(s);
  const month = filterRange(history, "1M");
  const d = deltaSummary(history.length >= 2 ? history : []);
  const deltaText = d ? `${esc(fmtDelta(d, c ?? "USD"))} <span class="sr-muted">vs first seen</span>` : s.detail ? '<span class="sr-muted">History starts now</span>' : '<span class="sr-muted">Watch to track</span>';
  const priceTile = tile("Current price", price !== null ? money(price, c) : "n/a", deltaText, d?.direction === "down" ? "sr-red" : d?.direction === "up" ? "sr-green" : "", month.length >= 2 ? sparkline(month, d?.direction !== "down") : "");

  // 2. Landed cost and margin, with the editable unit cost saved to the server.
  let costTile: string;
  if (!eco) costTile = tile("Landed cost", "n/a", "No price on this page");
  else {
    const editing = s.unitCostDraft !== null;
    const source = eco.unitCostSource === "product" ? "set for this product" : `estimate: ${s.settings.unit_cost_pct ?? DEFAULT_UNIT_COST_PCT}% of retail`;
    const edit = s.detail
      ? editing
        ? `<div class="sr-tile__edit"><input data-field="unitCost" type="text" inputmode="decimal" value="${esc(s.unitCostDraft ?? "")}" aria-label="Landed cost per unit"><button class="sr-btn sr-btn--primary" data-action="save-unitcost" ${s.busy ? "disabled" : ""}>${s.busy === "unitcost" ? "..." : "Save"}</button><button class="sr-btn sr-btn--plain" data-action="cancel-unitcost">Cancel</button></div>`
        : `<div class="sr-tile__edit"><button class="sr-btn sr-btn--plain" data-action="edit-unitcost">${eco.unitCostSource === "product" ? "Edit unit cost" : "Set unit cost"}</button></div>`
      : "";
    costTile = tile("Landed cost", money(eco.base, c), `<span class="sr-num">${esc(fmtPct(eco.marginPct))} margin</span> <span class="sr-muted">${esc(source)}</span>`, "", edit);
  }

  // 3. Duty exposure: origin, catalog heading, open tariff points.
  const origin = product?.profile?.origin_country;
  const hts = product?.profile?.hts_candidates?.[0];
  const pts = tariff?.impact?.tariff_rate_change_pct ?? null;
  const dutyValue = pts != null ? `${pts > 0 ? "+" : ""}${pts} pts` : hts?.code ? `HS ${hts.code}` : origin ? (COUNTRY[origin.toUpperCase()] ?? origin) : "Unknown";
  const dutyDelta = pts != null ? `${esc(hts?.code ? `HS ${hts.code}, ` : "")}${esc(origin ? (COUNTRY[origin.toUpperCase()] ?? origin) : "origin unknown")} <span class="sr-red">open tariff alert</span>` : hts?.code ? `${esc(hts.description)}${origin ? `, from ${esc(COUNTRY[origin.toUpperCase()] ?? origin)}` : ", origin unknown"}` : s.detail ? "Set the origin in Shop Rules to sharpen tariff checks" : "Classified when you watch it";
  const dutyTile = tile("Duty exposure", dutyValue, dutyDelta, pts != null && pts > 0 ? "" : "");

  // 4. Weekly margin drag from the open tariff alert, at the seller's units per week.
  const drag = eco && eco.pricing.basis !== "none" ? eco.pricing.weekly_drag : 0;
  const dragTile = tile(
    "Weekly margin drag",
    eco ? (drag < 0 ? signedMoney(drag, c) : money(0, c)) : "n/a",
    eco ? (drag < 0 ? `${eco.unitsPerWeek} units/wk x ${esc(signedMoney(eco.costDelta, c))} per unit` : `${eco.unitsPerWeek} units/wk, no open cost change`) : "",
    drag < 0 ? "sr-red" : "",
  );

  return `<div class="sr-tiles" style="margin-bottom:12px">${priceTile}${costTile}${dutyTile}${dragTile}</div>`;
}

function ruleStatus(rule: Rule, alert: Alert | undefined, run: RunResponse["run"] | null): { label: string; tone: Tone; live: boolean } {
  const item = run?.items.find((i) => i.rule_id === rule.id);
  if (item && item.status === "checking") return { label: "Checking", tone: "info", live: true };
  if (item && item.status === "queued" && run?.status === "running") return { label: "Queued", tone: "neutral", live: false };
  if (alert) return { label: "Alert", tone: alert.severity === "high" ? "critical" : "warning", live: false };
  if (rule.last_run_at) return { label: "Clear", tone: "success", live: false };
  return { label: "Not checked", tone: "neutral", live: false };
}

function renderRules(s: PanelState): string {
  const title = "Rules that touch this product";
  if (s.phase === "loading") return card(title, skeleton(4));
  if (s.phase === "error") return card(title, unavailable());
  if (!s.detail) {
    const families = s.lookup?.families_preview ?? ["tariff", "safety", "tax", "policy"];
    const body = `<p class="sr-muted">Watch this product to seed its rules: ${families.map((f) => familyLabel(f).toLowerCase()).join(", ")}. Each one is checked against the official source on its own schedule.</p>`;
    return card(title, body);
  }
  const byRule = new Map<string, Alert>();
  for (const a of openAlerts(s.detail)) if (a.kind !== "price" && !byRule.has(a.rule_id)) byRule.set(a.rule_id, a);
  const groups = FAMILY_ORDER.map((family) => {
    const rules = s.detail!.rules.filter((r) => r.family === family);
    if (rules.length === 0) return "";
    const open = rules.filter((r) => byRule.has(r.id)).length;
    const rows = rules
      .map((r) => {
        const st = ruleStatus(r, byRule.get(r.id), s.checkRun);
        const when = r.last_run_at ? timeAgo(r.last_run_at) : null;
        return `<div class="sr-rule"><span class="sr-rule__title" title="${esc(r.title)}">${esc(r.title)}</span><span class="sr-rule__meta">${when && st.label !== "Checking" ? `${esc(when)} ` : ""}${pill(st.tone, st.label, { dot: !st.live, live: st.live, lower: true })}</span></div>`;
      })
      .join("");
    return `<div class="sr-rulegroup"><div class="sr-rulegroup__head"><span>${esc(FAMILY_LABEL[family])}</span>${open ? pill("critical", `${open} alert${open === 1 ? "" : "s"}`, { lower: true }) : `<span class="sr-muted sr-small">${rules.length} rule${rules.length === 1 ? "" : "s"}</span>`}</div>${rows}</div>`;
  }).join("");
  const due = s.detail.rules.filter((r) => !r.last_run_at || Date.now() - new Date(r.last_run_at).getTime() > r.cadence_hours * 3600 * 1000).length;
  const run = s.checkRun;
  let progress = "";
  if (s.busy === "check") {
    const total = run?.total ?? 0;
    const done = run?.done ?? 0;
    const pct = total ? Math.round((done / total) * 100) : 5;
    const current = run?.current?.length ? Array.from(new Set(run.current)).join(", ") : "starting";
    progress = `<div class="sr-progress" role="status" aria-live="polite">Checked ${done} of ${total || "?"}: ${esc(current)}<div class="sr-progress__bar"><div class="sr-progress__fill" style="width:${pct}%"></div></div><span>Unchanged sources skip the model. Rules run three at a time.</span></div>`;
  }
  const button = `<button class="sr-btn sr-btn--secondary" data-action="check" ${s.busy ? "disabled" : ""}>${s.busy === "check" ? "Checking..." : due ? `Check now (${due} due)` : "Check now"}</button>`;
  return card(title, `${groups}${progress}<div style="margin-top:10px">${button}</div>`);
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
  if (eco.deltaKind === "tariff") first = metric("Duty change", `${up ? "+" : ""}${eco.delta} pts`, up ? "Rate rises vs the previous rate" : "Rate falls vs the previous rate", costTone);
  else if (eco.deltaKind === "cost") first = metric("Est. cost change", fmtPct(eco.delta, true), "Stated by the source", costTone);
  else first = metric("Severity", capitalize(alert.severity), relevance);
  const landed = changed
    ? metric("Landed cost / unit", money(eco.landed, c), `${signedMoney(eco.costDelta, c)} vs ${money(eco.base, c)} base`, costTone)
    : metric("Landed cost / unit", money(eco.base, c), "No cost change on file");
  const keep = eco.marginPct > 0 ? Math.max(0, Math.min(100, (eco.marginAfterPct / eco.marginPct) * 100)) : 0;
  const bar = `<div class="sr-bar"><span class="sr-bar__keep" style="width:${keep.toFixed(1)}%"></span><span class="sr-bar__lost" style="width:${(100 - keep).toFixed(1)}%"></span></div>`;
  const shift = eco.marginAfterPct - eco.marginPct;
  const margin = metric("Net margin", fmtPct(eco.marginAfterPct), changed ? `was ${fmtPct(eco.marginPct)} (${shift > 0 ? "+" : ""}${shift.toFixed(1)} pts)` : "Unchanged by this alert", changed && shift < 0 ? "sr-red" : "sr-muted", bar);
  const weekly = eco.pricing.weekly_drag;
  const drag = changed
    ? metric("Weekly profit drag", signedMoney(weekly, c), `${eco.unitsPerWeek} units/wk x ${money(Math.abs(eco.costDelta), c)}`, weekly < 0 ? "sr-red" : "sr-green")
    : metric("Weekly profit drag", money(0, c), `${eco.unitsPerWeek} units/wk, no cost change`);
  return `<div class="sr-metrics">${first}${landed}${margin}${drag}</div>`;
}

function renderPriceChange(alert: Alert, c: string | null): string {
  const pc = alert.price_change;
  if (!pc) return "";
  const up = pc.delta > 0;
  return `<div class="sr-metrics">${metric("Was", money(pc.old_price, c), "previous observation")}${metric("Now", money(pc.new_price, c), `${signedMoney(pc.delta, c)} (${up ? "+" : ""}${pc.pct}%)`, up ? "sr-green" : "sr-red")}</div>`;
}

function renderTopAlert(s: PanelState): string {
  const title = "Top alert";
  if (s.phase === "loading") return card(title, skeleton(4));
  if (s.phase === "error") return card(title, unavailable());
  if (!s.detail) return card(title, '<p class="sr-muted">Watch this product to get verified alerts with the duty, cost, and margin impact and a reprice that is computed, not guessed.</p>');
  const alert = topAlert(s.detail);
  if (!alert) {
    const checked = timeAgo(s.detail.product.last_checked_at);
    return card(title, `<p class="sr-muted">No open alerts.${checked ? ` Last checked ${esc(checked)}.` : ""}</p>`, "success");
  }
  const open = openAlerts(s.detail).length;
  const c = currentCurrency(s);
  const eco = economics(s, alert);
  const hts = s.detail.product.profile?.hts_candidates?.[0];
  const more = open - 1;
  const isPrice = alert.kind === "price";
  const head = `<div class="sr-alert__head">${pill(SEVERITY_TONE[alert.severity] ?? "neutral", alert.severity)}${isPrice ? pill("info", "Price change") : pill(familyTone(alert.family), familyLabel(alert.family))}${pill(alert.relevance === "affects" ? "critical" : "warning", alert.relevance === "affects" ? "Affects product" : "Might affect")}</div>`;
  const when = fmtDate(alert.impact?.effective_date);
  const body = isPrice
    ? renderPriceChange(alert, c)
    : `${hts?.code ? `<p class="sr-muted sr-small sr-num">HS ${esc(hts.code)}${hts.description ? ` · ${esc(hts.description)}` : ""}${when ? ` · effective ${esc(when)}` : ""}</p>` : when ? `<p class="sr-muted sr-small">Effective ${esc(when)}</p>` : ""}${evidenceBar(alert)}${eco ? renderMetrics(eco, alert) : '<p class="sr-muted sr-small" style="margin-top:8px">No page price, so the cost impact cannot be computed.</p>'}`;

  // Reprice block from the stored PricingResult.
  const suggested = eco?.pricing.suggested_price ?? null;
  let reprice = "";
  if (eco && suggested !== null && !isPrice) {
    const label = s.busy === "reprice" ? "Copying..." : `Draft reprice (${money(suggested, c)})`;
    reprice = `<div class="sr-inset" style="margin-top:10px"><div class="sr-reprice"><div><div class="sr-muted sr-small">Adjust to</div><div class="sr-reprice__big sr-num">${esc(money(suggested, c))}</div></div><div style="text-align:right"><div class="sr-muted sr-small">Retail change</div><div class="sr-reprice__delta sr-num">${esc(signedMoney(eco.pricing.suggested_delta ?? 0, c))}</div><div class="sr-muted sr-small sr-num">holds ${esc(fmtPct(eco.pricing.margin_at_suggested_pct))} margin</div></div></div><p class="sr-muted sr-small" style="margin-top:8px">${esc(eco.pricing.explanation)}</p><button class="sr-btn sr-btn--primary sr-btn--block" data-action="reprice" style="margin-top:10px" ${s.busy ? "disabled" : ""}>${esc(label)}</button><p class="sr-muted sr-small" style="margin-top:6px">Copies the price, marks this alert done, and records the reprice in the price history.</p></div>`;
  } else if (eco && eco.pricing.strategy === "absorb" && eco.pricing.basis !== "none") {
    reprice = `<p class="sr-muted sr-small" style="margin-top:8px">${esc(eco.pricing.explanation)}</p>`;
  }

  const dismiss = s.dismissOpen
    ? `<div><textarea class="sr-textarea" data-field="dismissReason" placeholder="Why does this not apply? One sentence. Shop Rules turns it into a standing instruction for future checks.">${esc(s.dismissReason)}</textarea><div class="sr-row" style="margin-top:8px"><button class="sr-btn sr-btn--primary" data-action="dismiss-confirm" ${s.busy ? "disabled" : ""}>${s.busy === "dismiss" ? "Saving..." : "Dismiss alert"}</button><button class="sr-btn sr-btn--secondary" data-action="dismiss-cancel" ${s.busy ? "disabled" : ""}>Cancel</button></div></div>`
    : "";
  const actions = `<div class="sr-row" style="margin-top:10px">${s.dismissOpen ? "" : `<button class="sr-btn sr-btn--secondary" data-action="dismiss-open" ${s.busy ? "disabled" : ""}>Dismiss with reason</button>`}<a class="sr-btn sr-btn--secondary" href="${esc(`${s.baseUrl}/alerts/${encodeURIComponent(alert.id)}`)}" target="_blank" rel="noopener">Open evidence</a></div>${dismiss}`;
  const moreLine = more > 0 ? `<p class="sr-small" style="margin-top:6px"><a class="sr-link" href="${esc(productUrl(s))}" target="_blank" rel="noopener">${more} more open alert${more === 1 ? "" : "s"} in Shop Rules</a></p>` : "";
  return card(open > 1 ? `${title} (1 of ${open})` : title, `${head}<p class="sr-alert__headline">${esc(alert.headline)}</p>${body}${alert.action?.title ? `<p class="sr-alert__action">${esc(alert.action.title)}</p>` : ""}${reprice}${actions}${moreLine}`, alert.severity === "high" ? "critical" : "warning");
}

function renderCompare(s: PanelState): string {
  const title = "Compare";
  if (s.phase === "loading") return card(title, skeleton(2));
  if (s.phase === "error") return card(title, unavailable());
  const hasTitle = Boolean(s.page.title ?? s.detail?.product.title);
  const label = s.busy === "compare" ? "Searching..." : s.compare ? (s.compare.cached ? "Refresh prices" : "Search again") : "Find competitor prices";
  const button = `<button class="sr-btn sr-btn--secondary sr-btn--block" data-action="compare" ${s.busy || !hasTitle ? "disabled" : ""}>${label}</button>`;
  const parts = [button];
  if (!hasTitle) parts.push('<p class="sr-muted sr-small" style="margin-top:8px">No product title found on this page.</p>');
  if (!s.compare && hasTitle) parts.push('<p class="sr-muted sr-small" style="margin-top:8px">Competitor median and where this listing sits. Results are kept for 24 hours per product.</p>');
  if (s.compareError) parts.push(`<div class="sr-banner sr-banner--critical" style="margin:10px 0 0"><p>${esc(s.compareError)}</p></div>`);
  if (s.compare) {
    const position = POSITION[s.compare.price_position] ?? POSITION.unknown;
    const listings = s.compare.listings.filter((l) => canonicalProductUrl(l.url, s.marketplace) !== s.page.url);
    const priced = listings.map((l) => l.price).filter((p): p is number => typeof p === "number" && p > 0).sort((a, b) => a - b);
    const median = priced.length ? (priced[Math.floor(priced.length / 2)] ?? null) : null;
    const mine = currentPrice(s);
    const c = currentCurrency(s);
    const vs = median !== null && mine !== null ? `${esc(signedMoney(mine - median, c))} vs median ${esc(money(median, c))}` : s.compare.note;
    const cachedNote = s.compare.cached && s.compare.cached_at ? `<span class="sr-muted sr-small">cached ${esc(timeAgo(s.compare.cached_at) ?? "")}</span>` : "";
    parts.push(`<div class="sr-compare__head">${pill(position.tone, position.label)}<span class="sr-muted sr-small sr-num">${vs}</span>${cachedNote}</div>`);
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
    ? `<ol class="sr-helpsteps">
        <li>Open the Shop Rules web app, go to Settings, and click "Connect Chrome extension". That is all.</li>
        <li>If that page cannot see the extension, click the Shop Rules icon in the toolbar (pin it from the puzzle menu) and paste the token from Settings into the popup.</li>
      </ol>`
    : "";
  return card(
    "Connect your Shop Rules account",
    `<p class="sr-muted" style="margin-bottom:10px">One click on the Settings page connects this extension to your workspace. Then this panel shows rules, alerts, price history, and margin for every listing.</p>
    <div class="sr-row"><a class="sr-btn sr-btn--primary" href="${esc(`${s.baseUrl || "https://shop-rules.vercel.app"}/settings`)}" target="_blank" rel="noopener">Open Settings</a><button class="sr-btn sr-btn--secondary" data-action="help">${s.showHelp ? "Open the popup" : "Show me how"}</button></div>${steps}`,
    "info",
  );
}

function renderReconnect(s: PanelState): string {
  return card(
    "Token rejected",
    `<p class="sr-muted" style="margin-bottom:10px">${esc(s.error ?? "Shop Rules did not accept the saved account token.")} Reconnect from the Settings page, or paste a fresh token into the popup.</p>
    <div class="sr-row"><a class="sr-btn sr-btn--primary" href="${esc(`${s.baseUrl || "https://shop-rules.vercel.app"}/settings`)}" target="_blank" rel="noopener">Reconnect Shop Rules</a><button class="sr-btn sr-btn--secondary" data-action="reconnect">Open popup</button></div>`,
    "critical",
  );
}

function renderBanners(s: PanelState): string {
  const out: string[] = [];
  if (s.phase === "error" && s.error) {
    out.push(`<div class="sr-banner sr-banner--critical" role="alert"><p>${esc(s.error)}</p><button class="sr-btn sr-btn--secondary" data-action="retry">Retry</button></div>`);
  }
  if (s.actionError) {
    out.push(`<div class="sr-banner sr-banner--critical" role="alert"><p>${esc(s.actionError)}</p><button class="sr-btn sr-btn--secondary" data-action="dismiss">Dismiss</button></div>`);
  }
  if (s.notice) {
    out.push(`<div class="sr-banner sr-banner--success" role="status"><p>${esc(s.notice)}</p><button class="sr-btn sr-btn--secondary" data-action="dismiss">Dismiss</button></div>`);
  }
  return out.join("");
}

function renderBody(s: PanelState): string {
  if (s.phase === "unconfigured") return renderBanners(s) + renderConnect(s);
  if (s.phase === "auth") return renderBanners(s) + renderReconnect(s);
  return renderBanners(s) + renderStats(s) + renderRules(s) + renderTopAlert(s) + renderCompare(s);
}

function renderFooter(s: PanelState): string {
  const status =
    s.phase === "loading"
      ? pill("neutral", "Connecting", { live: true, lower: true })
      : s.phase === "unconfigured"
        ? pill("neutral", "Not connected", { dot: true, lower: true })
        : s.phase === "auth"
          ? pill("critical", "Token rejected", { dot: true, lower: true })
          : s.phase === "error"
            ? pill("critical", "Unreachable", { dot: true, lower: true })
            : pill("success", "Connected", { dot: true, lower: true });
  const links = `<a class="sr-link" href="${esc(productUrl(s))}" target="_blank" rel="noopener">${s.detail ? "Open in Shop Rules" : "Open Shop Rules"}</a>${s.detail ? '<button class="sr-btn sr-btn--plain" data-action="export" style="min-height:20px;padding:0">Export dossier</button>' : ""}`;
  return `<footer class="sr-footer"><div class="sr-footer__links">${links}</div>${status}</footer>`;
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

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Panel

export class Panel {
  private host: HTMLDivElement | null = null;
  private root: ShadowRoot | null = null;
  private panelEl: HTMLDivElement | null = null;
  private state: PanelState | null = null;
  private seq = 0;
  private closeTimer: number | null = null;
  private pollTimer: number | null = null;
  private previousFocus: Element | null = null;
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (!this.isOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === "Tab") this.trapTab(event);
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
    this.stopPolling();
    this.previousFocus = document.activeElement;
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
      busy: null,
      compare: null,
      compareError: null,
      showHelp: false,
      unitCostDraft: null,
      checkRun: null,
      ingestRun: null,
      dismissOpen: false,
      dismissReason: "",
    };
    this.render();
    const panel = this.panelEl;
    requestAnimationFrame(() => {
      panel?.classList.add("is-open");
      const first = panel?.querySelector<HTMLElement>(".sr-close");
      (first ?? panel)?.focus({ preventScroll: true });
    });
    this.onToggle(true);
    void this.load(this.seq);
  }

  close(): void {
    const panel = this.panelEl;
    if (!panel) return;
    panel.classList.remove("is-open");
    window.removeEventListener("keydown", this.onKeydown, true);
    this.stopPolling();
    this.onToggle(false);
    const prev = this.previousFocus;
    if (prev instanceof HTMLElement) {
      try {
        prev.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }
    this.closeTimer = window.setTimeout(() => this.unmount(), 220);
  }

  // Tab cycles inside the dialog.
  private trapTab(event: KeyboardEvent): void {
    const panel = this.panelEl;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === panel);
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const active = this.root?.activeElement as HTMLElement | null;
    const index = active ? items.indexOf(active) : -1;
    if (event.shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    } else if (index === -1 || index >= items.length - 1) {
      event.preventDefault();
      items[0]?.focus();
    }
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
    const important: Record<string, string> = { all: "initial", position: "fixed", top: "0", right: "0", width: "0", height: "0", "z-index": "2147483647", display: "block" };
    for (const [prop, value] of Object.entries(important)) host.style.setProperty(prop, value, "important");
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLES;
    const panel = document.createElement("div");
    panel.className = "sr-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Shop Rules product stats");
    panel.tabIndex = -1;
    panel.addEventListener("click", (event) => this.handleClick(event));
    panel.addEventListener("input", (event) => this.handleInput(event));
    panel.addEventListener("keydown", (event) => this.handleFieldKeys(event));
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
  // field (with its caret) so typing feels live.
  private render(): void {
    const panel = this.panelEl;
    const s = this.state;
    if (!panel || !s) return;
    const active = this.root?.activeElement;
    const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.dataset.field : undefined;
    const caret = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.selectionStart : null;
    const actionBtn = active instanceof HTMLElement ? active.dataset.action : undefined;
    const scrollTop = panel.querySelector(".sr-body")?.scrollTop ?? 0;
    panel.innerHTML = `${renderHeader(s)}<div class="sr-body">${renderBody(s)}</div>${renderFooter(s)}`;
    const body = panel.querySelector(".sr-body");
    if (body) body.scrollTop = scrollTop;
    if (field) {
      const input = panel.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${field}"]`);
      if (input) {
        input.focus({ preventScroll: true });
        if (caret !== null) input.setSelectionRange(caret, caret);
      }
    } else if (actionBtn) {
      panel.querySelector<HTMLElement>(`[data-action="${actionBtn}"]`)?.focus({ preventScroll: true });
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
      case "edit-unitcost": {
        const eco = this.state ? economics(this.state, null) : null;
        this.update({ unitCostDraft: eco ? eco.base.toFixed(2) : "" });
        window.setTimeout(() => this.panelEl?.querySelector<HTMLInputElement>('[data-field="unitCost"]')?.select(), 0);
        break;
      }
      case "cancel-unitcost":
        this.update({ unitCostDraft: null });
        break;
      case "save-unitcost":
        void this.saveUnitCost();
        break;
      case "dismiss-open":
        this.update({ dismissOpen: true });
        window.setTimeout(() => this.panelEl?.querySelector<HTMLTextAreaElement>('[data-field="dismissReason"]')?.focus(), 0);
        break;
      case "dismiss-cancel":
        this.update({ dismissOpen: false, dismissReason: "" });
        break;
      case "dismiss-confirm":
        void this.dismiss();
        break;
      case "help":
        this.update({ showHelp: true });
        void this.send({ type: "open-popup" });
        break;
      case "reconnect":
        void this.send({ type: "open-popup" });
        break;
      default:
        break;
    }
  }

  private handleInput(event: Event): void {
    const input = event.target;
    if (!this.state) return;
    if (input instanceof HTMLInputElement && input.dataset.field === "unitCost") this.state.unitCostDraft = input.value;
    if (input instanceof HTMLTextAreaElement && input.dataset.field === "dismissReason") this.state.dismissReason = input.value;
  }

  private handleFieldKeys(event: KeyboardEvent): void {
    const el = event.target;
    if (el instanceof HTMLInputElement && el.dataset.field === "unitCost" && event.key === "Enter") {
      event.preventDefault();
      void this.saveUnitCost();
    }
    if (el instanceof HTMLTextAreaElement && el.dataset.field === "dismissReason" && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void this.dismiss();
    }
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
    const [lookup, account] = await Promise.all([this.send<LookupResponse>({ type: "lookup", url: s.page.url }), this.send<AccountResponse>({ type: "account" })]);
    if (!this.current(seq)) return;
    if (account.ok && account.data?.account?.settings && typeof account.data.account.settings === "object") s.settings = account.data.account.settings;
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
    else if (code === "auth") this.update({ phase: "auth", error });
    else this.update({ phase: "error", error });
  }

  // Polls GET /api/runs/[id] while a check or an ingest is in flight.
  private startPolling(seq: number, runId: string, kind: "check" | "ingest"): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      void this.send<RunResponse>({ type: "run", id: runId }).then((r) => {
        if (!this.current(seq) || !r.ok) return;
        if (kind === "check") this.update({ checkRun: r.data.run });
        else this.update({ ingestRun: r.data.run });
      });
    }, POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async watch(): Promise<void> {
    const s = this.state;
    if (!s || s.busy) return;
    const seq = this.seq;
    const runId = newRunId();
    this.update({ busy: "watch", actionError: null, notice: null, ingestRun: null });
    this.startPolling(seq, runId, "ingest");
    const page = { ...toPayload(s.page, s.marketplace), run_id: runId } as PagePayload & { run_id: string };
    const result = await this.send<WatchResponse>({ type: "watch", url: s.page.url, page });
    this.stopPolling();
    if (!this.current(seq)) return;
    if (!result.ok) {
      this.update({ busy: null, actionError: result.error, ingestRun: s.ingestRun && s.ingestRun.status === "failed" ? s.ingestRun : null });
      return;
    }
    const seeded = result.data.rules?.length ?? 0;
    const notice = result.data.existing ? "This product was already on your watchlist." : `Watching. ${seeded} rule${seeded === 1 ? "" : "s"} seeded; the first check runs on schedule or when you press Check now.`;
    const lookup: LookupResponse = { ...(s.lookup ?? { marketplace: s.marketplace, families_preview: [] }), watched: true, product: result.data.product };
    this.update({ busy: null, notice, lookup, ingestRun: null });
    await this.loadDetail(seq, result.data.product.id);
    if (this.current(seq) && s.page.price !== null) {
      void this.send({ type: "observe", id: result.data.product.id, price: s.page.price, currency: s.page.currency, confidence: 0.9 });
    }
  }

  private async check(): Promise<void> {
    const s = this.state;
    const id = s?.detail?.product.id;
    if (!s || !id || s.busy) return;
    const seq = this.seq;
    const runId = newRunId();
    this.update({ busy: "check", actionError: null, notice: null, checkRun: null });
    this.startPolling(seq, runId, "check");
    const result = await this.send<CheckResponse>({ type: "check", id, scope: "due", run_id: runId });
    this.stopPolling();
    if (!this.current(seq)) return;
    if (!result.ok) {
      this.update({ busy: null, actionError: result.error, checkRun: null });
      return;
    }
    const found = result.data.alerts?.length ?? 0;
    const unchanged = result.data.skipped_unchanged ?? 0;
    const notice = result.data.checked === 0 ? "Nothing was due. Every rule is on schedule." : `Checked ${result.data.checked} rule${result.data.checked === 1 ? "" : "s"}: ${found} new alert${found === 1 ? "" : "s"}${unchanged ? `, ${unchanged} unchanged since last time` : ""}.${result.data.errors?.length ? ` ${result.data.errors.length} could not run.` : ""}`;
    this.update({ busy: null, notice, checkRun: null });
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
      body: { title, marketplace: s.marketplace, url: s.page.url, ...(s.detail ? { product_id: s.detail.product.id } : {}), ...(s.compare?.cached ? { force: true } : {}), ...(price !== null ? { price } : {}) },
    });
    if (!this.current(seq)) return;
    if (!result.ok) {
      this.update({ busy: null, compareError: result.error });
      return;
    }
    this.update({ busy: null, compare: result.data });
  }

  // Copies the suggested price and marks the alert actioned on the server,
  // which also updates the product price and records a reprice point.
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
    this.update({ busy: null, notice: `${copyNote}Alert marked done and the reprice is in the price history. Paste the price into your listing editor.` });
    await this.loadDetail(seq, alert.product_id);
  }

  private async dismiss(): Promise<void> {
    const s = this.state;
    const alert = s ? topAlert(s.detail) : null;
    if (!s || !alert || s.busy) return;
    const reason = s.dismissReason.trim();
    if (reason.length < 6) {
      this.update({ actionError: "Give a short reason (at least a few words) so future checks can learn from it." });
      return;
    }
    const seq = this.seq;
    this.update({ busy: "dismiss", actionError: null, notice: null });
    const result = await this.send<{ skill?: { skill: string } | null }>({ type: "alertStatus", id: alert.id, status: "dismissed", reason });
    if (!this.current(seq)) return;
    if (!result.ok) {
      this.update({ busy: null, actionError: result.error });
      return;
    }
    const skill = result.data?.skill?.skill;
    this.update({ busy: null, dismissOpen: false, dismissReason: "", notice: skill ? `Dismissed. Standing instruction saved: "${skill}"` : "Dismissed." });
    await this.loadDetail(seq, alert.product_id);
  }

  private async saveUnitCost(): Promise<void> {
    const s = this.state;
    const id = s?.detail?.product.id;
    if (!s || !id || s.busy || s.unitCostDraft === null) return;
    const value = num(s.unitCostDraft);
    if (value === null || value < 0) {
      this.update({ actionError: "Enter the landed cost per unit as a number, like 13.50." });
      return;
    }
    const seq = this.seq;
    this.update({ busy: "unitcost", actionError: null });
    const result = await this.send<{ product: Product }>({ type: "patchProduct", id, patch: { unit_cost: value } });
    if (!this.current(seq)) return;
    if (!result.ok) {
      this.update({ busy: null, actionError: result.error });
      return;
    }
    if (s.detail) s.detail.product = result.data.product;
    this.update({ busy: null, unitCostDraft: null, notice: `Unit cost saved for this product: ${money(value, currentCurrency(s))}. Margin and reprice math now use it.` });
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
