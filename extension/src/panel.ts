// The slide-in overlay. Lives in a Shadow DOM host so site CSS cannot touch
// it, and talks to the API only through the background worker.
import type {
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
  ProductDetailResponse,
  Rule,
  RuleFamily,
  Severity,
  Settings,
  WatchResponse,
} from "./types";

export type Send = <T>(message: BgRequest) => Promise<BgResult<T>>;

type Phase = "loading" | "ready" | "unconfigured" | "error";
type Busy = "watch" | "check" | "compare" | null;
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
  busy: Busy;
  compare: CompareResponse | null;
  compareError: string | null;
  showHelp: boolean;
}

const HOST_ID = "shop-rules-host";
const MAX_ALERTS = 3;
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

const LOGO_SVG =
  '<svg width="20" height="20" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="7" fill="#008060"/>' +
  '<path d="M14 5.5l7 2.7v5.3c0 4.4-3 8.4-7 9.5-4-1.1-7-5.1-7-9.5V8.2l7-2.7z" fill="#fff" opacity="0.95"/>' +
  '<path d="M10.6 14.2l2.3 2.3 4.6-4.8" stroke="#008060" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

const STYLES = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.sr-panel {
  position: fixed; top: 0; right: 0; width: 420px; max-width: 100vw; height: 100vh;
  display: flex; flex-direction: column;
  background: #f1f1f1; color: #303030;
  font-family: Inter, -apple-system, "Segoe UI", sans-serif; font-size: 13px; line-height: 1.45;
  box-shadow: -8px 0 24px rgba(0,0,0,0.12);
  transform: translateX(100%); transition: transform 180ms ease-out;
  z-index: 2147483647; outline: none;
}
.sr-panel.is-open { transform: translateX(0); }
.sr-header { flex: none; background: #fff; border-bottom: 1px solid #e3e3e3; padding: 12px 16px; }
.sr-brand { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.sr-brand__name { font-weight: 700; font-size: 14px; color: #008060; flex: 1; }
.sr-close {
  width: 28px; height: 28px; border: 1px solid #e3e3e3; border-radius: 8px; background: #fff; color: #616161;
  cursor: pointer; font: inherit; font-size: 16px; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
}
.sr-close:hover { background: #f1f1f1; color: #303030; }
.sr-title {
  margin: 0 0 8px; font-size: 14px; font-weight: 600; line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.sr-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sr-price { font-weight: 600; }
.sr-body { flex: 1; overflow-y: auto; padding: 12px 16px 0; }
.sr-card {
  background: #fff; border: 1px solid #e3e3e3; border-radius: 12px; box-shadow: 0 1px 0 rgba(0,0,0,0.05);
  padding: 16px; margin-bottom: 12px;
}
.sr-card h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; color: #303030; }
.sr-card p { margin: 0; }
.sr-muted { color: #616161; }
.sr-small { font-size: 12px; }
.sr-actions { display: flex; gap: 8px; margin-bottom: 12px; }
.sr-actions > * { flex: 1; }
.sr-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 32px; padding: 6px 12px; border-radius: 8px; font: inherit; font-weight: 600; font-size: 13px;
  cursor: pointer; text-decoration: none; text-align: center; transition: background 120ms;
}
.sr-btn--primary { background: #303030; color: #fff; border: 1px solid #303030; }
.sr-btn--primary:hover { background: #1a1a1a; }
.sr-btn--secondary { background: #fff; color: #303030; border: 1px solid #e3e3e3; }
.sr-btn--secondary:hover { background: #f7f7f7; }
.sr-btn[disabled] { opacity: 0.55; cursor: default; }
.sr-btn--block { width: 100%; }
.sr-badge {
  display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px;
  font-size: 12px; font-weight: 500; line-height: 16px; white-space: nowrap;
}
.sr-badge--success { background: #cdfed4; color: #0c5132; }
.sr-badge--critical { background: #fee9e8; color: #8e1f0b; }
.sr-badge--warning { background: #ffd6a4; color: #5e4200; }
.sr-badge--info { background: #e0f0ff; color: #00527c; }
.sr-badge--neutral { background: #e3e3e3; color: #303030; }
.sr-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.sr-banner { border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; display: flex; gap: 10px; align-items: flex-start; }
.sr-banner p { flex: 1; margin: 0; }
.sr-banner--critical { background: #fee9e8; color: #8e1f0b; border: 1px solid #f8c9c4; }
.sr-banner--success { background: #cdfed4; color: #0c5132; border: 1px solid #a8e9b5; }
.sr-banner .sr-btn { min-height: 26px; padding: 2px 10px; }
.sr-group { margin-bottom: 10px; }
.sr-group:last-child { margin-bottom: 0; }
.sr-group__head { margin-bottom: 6px; }
.sr-rule { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-top: 1px solid #f1f1f1; }
.sr-rule__title { flex: 1; }
.sr-rule__time { color: #616161; font-size: 12px; white-space: nowrap; }
.sr-alert { padding: 10px 0; border-top: 1px solid #f1f1f1; }
.sr-alert:first-of-type { border-top: 0; padding-top: 0; }
.sr-alert__head { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.sr-alert__headline { font-weight: 600; margin: 0 0 6px; }
.sr-alert__action { margin: 6px 0 0; }
.sr-evidence__bar { display: flex; height: 6px; border-radius: 3px; background: #e3e3e3; overflow: hidden; }
.sr-evidence__backed { background: #29845a; height: 100%; }
.sr-evidence__rejected { background: #e51c00; height: 100%; }
.sr-evidence__caption { color: #616161; font-size: 12px; margin-top: 4px; }
.sr-spark { display: block; width: 100%; height: 56px; }
.sr-history__row { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; }
.sr-compare__row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid #f1f1f1; }
.sr-compare__title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-compare__price { font-weight: 600; white-space: nowrap; }
.sr-compare__head { display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; }
.sr-link { color: #008060; text-decoration: none; font-weight: 500; }
.sr-link:hover { text-decoration: underline; }
.sr-steps { margin: 10px 0 0; padding-left: 18px; }
.sr-steps li { margin-bottom: 4px; }
.sr-footer { flex: none; padding: 10px 16px; border-top: 1px solid #e3e3e3; background: #f1f1f1; color: #616161; font-size: 12px; }
.sr-skel { height: 12px; border-radius: 6px; margin: 6px 0; background: #ebebeb; background-image: linear-gradient(90deg, #ebebeb 0%, #f7f7f7 50%, #ebebeb 100%); background-size: 200% 100%; animation: sr-shimmer 1.2s ease-in-out infinite; }
.sr-skel--pill { width: 72px; height: 20px; border-radius: 999px; margin: 0; }
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

function badge(tone: Tone, label: string): string {
  return `<span class="sr-badge sr-badge--${tone}">${esc(label)}</span>`;
}

function card(title: string | null, body: string): string {
  return `<section class="sr-card">${title ? `<h3>${esc(title)}</h3>` : ""}${body}</section>`;
}

function skeleton(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `<div class="sr-skel" style="width:${90 - (i % 3) * 20}%"></div>`).join("");
}

function money(price: number | null | undefined, currency: string | null | undefined): string {
  if (price === null || price === undefined) return "";
  const code = currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(price);
  } catch {
    return `${price.toFixed(2)} ${code}`;
  }
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

function familyLabel(value: string): string {
  return FAMILY_LABEL[value as RuleFamily] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

function familyTone(value: string): Tone {
  return FAMILY_TONE[value as RuleFamily] ?? "neutral";
}

function marketBadge(value: string): string {
  return badge("neutral", MARKET_LABEL[value] ?? value);
}

function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function toPayload(page: PageProduct): PagePayload {
  const payload: PagePayload = {};
  if (page.title) payload.title = page.title;
  if (page.price !== null) payload.price = page.price;
  if (page.currency) payload.currency = page.currency;
  if (page.description) payload.description = page.description;
  if (page.materials) payload.materials = page.materials;
  if (page.image) payload.image = page.image;
  return payload;
}

// Section renderers

function renderHeader(s: PanelState): string {
  const product = s.detail?.product ?? s.lookup?.product ?? null;
  const title = s.page.title ?? product?.title ?? "Untitled product";
  const price = s.page.price ?? product?.price ?? null;
  const currency = s.page.currency ?? product?.currency ?? null;
  let watched: string;
  if (s.phase === "loading") watched = '<span class="sr-skel sr-skel--pill"></span>';
  else if (s.lookup?.watched || s.detail) watched = badge("success", "Watched");
  else watched = badge("neutral", "Not watched");
  return `<header class="sr-header">
    <div class="sr-brand">${LOGO_SVG}<span class="sr-brand__name">Shop Rules</span>
      <button class="sr-close" data-action="close" aria-label="Close" title="Close (Esc)">&times;</button></div>
    <h2 class="sr-title" title="${esc(title)}">${esc(title)}</h2>
    <div class="sr-meta">${marketBadge(s.marketplace)}${price !== null ? `<span class="sr-price">${esc(money(price, currency))}</span>` : ""}${watched}</div>
  </header>`;
}

function renderActions(s: PanelState): string {
  if (s.phase === "loading") {
    return '<div class="sr-actions"><span class="sr-skel sr-skel--btn"></span><span class="sr-skel sr-skel--btn"></span></div>';
  }
  const product = s.detail?.product ?? null;
  const open = product ? `${s.baseUrl}/products/${encodeURIComponent(product.id)}` : `${s.baseUrl}/`;
  const openLabel = product ? "Open in Shop Rules" : "Open Shop Rules";
  let primary: string;
  if (product) {
    const label = s.busy === "check" ? "Checking..." : "Run check now";
    primary = `<button class="sr-btn sr-btn--primary" data-action="check" ${s.busy ? "disabled" : ""}>${label}</button>`;
  } else {
    const label = s.busy === "watch" ? "Watching..." : "Watch this product";
    primary = `<button class="sr-btn sr-btn--primary" data-action="watch" ${s.busy ? "disabled" : ""}>${label}</button>`;
  }
  return `<div class="sr-actions">${primary}<a class="sr-btn sr-btn--secondary" href="${esc(open)}" target="_blank" rel="noopener">${openLabel}</a></div>`;
}

function renderRuleGroup(family: string, rules: Rule[]): string {
  const rows = rules
    .map((rule) => {
      const ran = timeAgo(rule.last_run_at);
      return `<div class="sr-rule"><span class="sr-rule__title">${esc(rule.title)}</span><span class="sr-rule__time">${ran ? `Ran ${esc(ran)}` : "Not run yet"}</span></div>`;
    })
    .join("");
  return `<div class="sr-group"><div class="sr-group__head">${badge(familyTone(family), familyLabel(family))}</div>${rows}</div>`;
}

function renderRules(s: PanelState): string {
  const title = "Rules that touch this product";
  if (s.phase === "loading") return card(title, skeleton(4));
  if (s.phase === "error") return card(title, '<p class="sr-muted">Not available until Shop Rules is reachable.</p>');
  if (s.detail) {
    if (s.detail.rules.length === 0) return card(title, '<p class="sr-muted">No rules seeded yet. Run a check to seed them.</p>');
    const groups = new Map<string, Rule[]>();
    for (const rule of s.detail.rules) groups.set(rule.family, [...(groups.get(rule.family) ?? []), rule]);
    return card(title, Array.from(groups, ([family, rules]) => renderRuleGroup(family, rules)).join(""));
  }
  const preview = s.lookup?.families_preview ?? [];
  const badges = preview.length
    ? `<div class="sr-badges">${preview.map((f) => badge(familyTone(f), familyLabel(f))).join("")}</div>`
    : "";
  const line = preview.length
    ? "These rule families are likely to touch this product. Watching it seeds the full rule set."
    : "Watch this product to seed the rule set that applies to it.";
  return card(title, `${badges}<p class="sr-muted">${line}</p>`);
}

function evidenceBar(a: Alert): string {
  const total = Math.max(a.proposed, a.backed + a.rejected, 1);
  const backed = (a.backed / total) * 100;
  const rejected = (a.rejected / total) * 100;
  return `<div class="sr-evidence"><div class="sr-evidence__bar"><span class="sr-evidence__backed" style="width:${backed}%"></span><span class="sr-evidence__rejected" style="width:${rejected}%"></span></div>
    <div class="sr-evidence__caption">${a.proposed} proposed, ${a.backed} backed, ${a.rejected} rejected</div></div>`;
}

function renderAlert(a: Alert, currency: string | null): string {
  const extras: string[] = [];
  if (a.impact?.effective_date) extras.push(`Effective ${esc(a.impact.effective_date)}`);
  if (a.action?.suggested_price !== null && a.action?.suggested_price !== undefined) {
    extras.push(`Suggested price ${esc(money(a.action.suggested_price, currency))}`);
  }
  return `<article class="sr-alert">
    <div class="sr-alert__head">${badge(SEVERITY_TONE[a.severity] ?? "neutral", a.severity)}${badge(familyTone(a.family), familyLabel(a.family))}</div>
    <p class="sr-alert__headline">${esc(a.headline)}</p>
    ${evidenceBar(a)}
    <p class="sr-alert__action">${esc(a.action?.title ?? "")}</p>
    ${extras.length ? `<p class="sr-muted sr-small">${extras.join(" &middot; ")}</p>` : ""}
  </article>`;
}

function openAlerts(detail: ProductDetailResponse): Alert[] {
  return detail.alerts
    .filter((a) => a.status === "new")
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || b.created_at.localeCompare(a.created_at));
}

function renderAlerts(s: PanelState): string {
  const title = "Open alerts";
  if (s.phase === "loading") return card(title, skeleton(3));
  if (s.phase === "error") return card(title, '<p class="sr-muted">Not available until Shop Rules is reachable.</p>');
  if (!s.detail) return card(title, '<p class="sr-muted">Watch this product to start receiving verified alerts.</p>');
  const alerts = openAlerts(s.detail);
  if (alerts.length === 0) {
    const checked = timeAgo(s.detail.product.last_checked_at);
    return card(title, `<p class="sr-muted">No open alerts.${checked ? ` Last checked ${esc(checked)}.` : ""}</p>`);
  }
  const currency = s.detail.product.currency ?? s.page.currency;
  const shown = alerts.slice(0, MAX_ALERTS).map((a) => renderAlert(a, currency)).join("");
  const more =
    alerts.length > MAX_ALERTS
      ? `<p class="sr-small"><a class="sr-link" href="${esc(`${s.baseUrl}/products/${encodeURIComponent(s.detail.product.id)}`)}" target="_blank" rel="noopener">${alerts.length - MAX_ALERTS} more in Shop Rules</a></p>`
      : "";
  return card(`${title} (${alerts.length})`, shown + more);
}

function sparkline(points: PricePoint[]): string {
  const w = 360;
  const h = 56;
  const pad = 6;
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => [pad + i * step, pad + (h - pad * 2) * (1 - (p.price - min) / span)] as const);
  const path = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const area = `${path} L${(last?.[0] ?? w).toFixed(1)} ${h - pad} L${pad} ${h - pad} Z`;
  return `<svg class="sr-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="#303030" opacity="0.06"/>
    <path d="${path}" fill="none" stroke="#303030" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${last ? `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="#303030"/>` : ""}
  </svg>`;
}

function renderPriceHistory(s: PanelState): string {
  const title = "Price history";
  if (s.phase === "loading") return card(title, skeleton(2));
  const product = s.detail?.product ?? s.lookup?.product ?? null;
  const currency = s.page.currency ?? product?.currency ?? null;
  const current = s.page.price ?? product?.price ?? null;
  const history = [...(s.detail?.price_history ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  if (history.length < 2) {
    const now = current !== null ? `<p><span class="sr-price">${esc(money(current, currency))}</span></p>` : "";
    const line = s.detail ? "History starts now." : "History starts when you watch this product.";
    return card(title, `${now}<p class="sr-muted">${line}</p>`);
  }
  const first = history[0];
  const last = history[history.length - 1];
  if (!first || !last) return card(title, '<p class="sr-muted">History starts now.</p>');
  const latest = current ?? last.price;
  const change = first.price ? ((latest - first.price) / first.price) * 100 : 0;
  const direction = change < -0.05 ? "Down" : change > 0.05 ? "Up" : "Unchanged";
  const since = timeAgo(first.at);
  const changeLine =
    direction === "Unchanged"
      ? `Unchanged since watched${since ? ` (${esc(since)})` : ""}.`
      : `${direction} ${Math.abs(change).toFixed(1)}% since watched${since ? ` (${esc(since)})` : ""}, from ${esc(money(first.price, first.currency ?? currency))}.`;
  return card(
    title,
    `${sparkline(history)}
    <div class="sr-history__row"><span class="sr-muted sr-small">${history.length} points, low ${esc(money(Math.min(...history.map((p) => p.price)), currency))}, high ${esc(money(Math.max(...history.map((p) => p.price)), currency))}</span><span class="sr-price">${esc(money(latest, currency))}</span></div>
    <p class="sr-small ${direction === "Down" ? "" : "sr-muted"}">${changeLine}</p>`,
  );
}

function renderCompare(s: PanelState): string {
  const title = "Compare";
  if (s.phase === "loading") return card(title, skeleton(2));
  if (s.phase === "error") return card(title, '<p class="sr-muted">Not available until Shop Rules is reachable.</p>');
  const hasTitle = Boolean(s.page.title ?? s.detail?.product.title);
  const label = s.busy === "compare" ? "Searching..." : s.compare ? "Search again" : "Find competitor prices";
  const button = `<button class="sr-btn sr-btn--secondary sr-btn--block" data-action="compare" ${s.busy || !hasTitle ? "disabled" : ""}>${label}</button>`;
  const parts = [button];
  if (!hasTitle) parts.push('<p class="sr-muted sr-small" style="margin-top:8px">No product title found on this page.</p>');
  if (s.compareError) parts.push(`<div class="sr-banner sr-banner--critical" style="margin:10px 0 0"><p>${esc(s.compareError)}</p></div>`);
  if (s.compare) {
    const position = POSITION[s.compare.price_position] ?? POSITION.unknown;
    parts.push(`<div class="sr-compare__head">${badge(position.tone, position.label)}<span class="sr-muted sr-small">${esc(s.compare.note)}</span></div>`);
    const rows = s.compare.listings.slice(0, MAX_COMPETITORS).map((l) => {
      const href = safeHref(l.url);
      const link = href ? `<a class="sr-link sr-small" href="${esc(href)}" target="_blank" rel="noopener">Open</a>` : "";
      return `<div class="sr-compare__row">${marketBadge(l.marketplace.toLowerCase())}<span class="sr-compare__title" title="${esc(l.title)}">${esc(l.title)}</span><span class="sr-compare__price">${esc(money(l.price, l.currency))}</span>${link}</div>`;
    });
    parts.push(rows.join("") || '<p class="sr-muted">No comparable listings found.</p>');
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
  return renderBanners(s) + renderActions(s) + renderRules(s) + renderAlerts(s) + renderPriceHistory(s) + renderCompare(s);
}

function renderFooter(): string {
  return '<footer class="sr-footer">Powered by Tavily and Nemotron on Nebius Token Factory</footer>';
}

// Panel

export class Panel {
  private host: HTMLDivElement | null = null;
  private panelEl: HTMLDivElement | null = null;
  private state: PanelState | null = null;
  private seq = 0;
  private closeTimer: number | null = null;
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
    root.append(style, panel);
    document.documentElement.appendChild(host);
    this.host = host;
    this.panelEl = panel;
    window.addEventListener("keydown", this.onKeydown, true);
  }

  private unmount(): void {
    this.host?.remove();
    this.host = null;
    this.panelEl = null;
    this.state = null;
    this.closeTimer = null;
  }

  private render(): void {
    if (!this.panelEl || !this.state) return;
    const s = this.state;
    this.panelEl.innerHTML = `${renderHeader(s)}<div class="sr-body">${renderBody(s)}</div>${renderFooter()}`;
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
      case "help":
        this.update({ showHelp: true });
        void this.send({ type: "open-popup" });
        break;
      default:
        break;
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
    const lookup = await this.send<LookupResponse>({ type: "lookup", url: s.page.url });
    if (!this.current(seq)) return;
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
    const result = await this.send<WatchResponse>({ type: "watch", url: s.page.url, page: toPayload(s.page) });
    if (!this.current(seq)) return;
    if (!result.ok) {
      this.update({ busy: null, actionError: result.error });
      return;
    }
    const seeded = result.data.rules?.length ?? 0;
    const notice = result.data.existing ? "This product was already watched." : `Now watching. ${seeded} rule${seeded === 1 ? "" : "s"} seeded.`;
    this.update({ busy: null, notice, lookup: { ...(s.lookup ?? { marketplace: s.marketplace, families_preview: [] }), watched: true, product: result.data.product } });
    await this.loadDetail(seq, result.data.product.id);
  }

  private async check(): Promise<void> {
    const s = this.state;
    const id = s?.detail?.product.id;
    if (!s || !id || s.busy) return;
    const seq = this.seq;
    this.update({ busy: "check", actionError: null, notice: null });
    const result = await this.send<CheckResponse>({ type: "check", id, force: true });
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
    const price = s.page.price ?? s.detail?.product.price ?? null;
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
}
