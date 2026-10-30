"use client";

// Shared presentation pieces for the seller-facing screens. Styled with the
// --sr-* variables in src/app/globals.css (tokens in docs/design/DESIGN.md).

import { AlertCircleIcon, AlertTriangleIcon, ArrowLeftIcon, CheckCircleIcon, ChevronDownIcon, ClockIcon, HomeIcon, ProductIcon, SettingsIcon } from "@shopify/polaris-icons";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";
import { timeAgo } from "@/lib/client";
import type { AccountRow, AlertRow, ProductRow } from "@/lib/db";
import { economicsFromPricing, fmtCompact, fmtMoney, fmtPct, type Economics } from "@/lib/economics";
import { pricingForAlert } from "@/lib/pricing";
import { FAMILY_LABEL } from "@/lib/rules-catalog";

export type Tone = "critical" | "warning" | "success" | "info" | "neutral";
export type Settings = AccountRow["settings"] | null | undefined;

// Small helpers shared by the pages

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function toneColor(tone: Tone): string {
  switch (tone) {
    case "critical":
      return "var(--sr-critical)";
    case "warning":
      return "var(--sr-warning-text)";
    case "success":
      return "var(--sr-primary)";
    case "info":
      return "var(--sr-info)";
    default:
      return "var(--sr-text-2)";
  }
}

export function marketplaceLabel(m: string | null | undefined): string {
  if (m === "etsy") return "Etsy";
  if (m === "shopify") return "Shopify";
  if (m === "amazon") return "Amazon";
  return "Web";
}

export function severityTone(severity: string | null | undefined): Tone {
  if (severity === "high") return "critical";
  if (severity === "medium") return "warning";
  return "info";
}

export function alertTone(alert: Pick<AlertRow, "status" | "severity">): Tone {
  if (alert.status === "actioned") return "success";
  if (alert.status === "dismissed") return "neutral";
  return severityTone(alert.severity);
}

export function actionLabel(type: string | null | undefined): string {
  if (type === "reprice") return "Reprice now";
  if (type === "register_tax") return "Review tax";
  if (type === "compliance_step") return "Review step";
  return "Open";
}

export const FAMILY_SHORT: Record<string, string> = { tariff: "Tariffs", tax: "Sales tax", safety: "Product safety", policy: "Policy" };

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function sourceDomain(alert: AlertRow): string | null {
  const backed = alert.claims?.find((c) => c.backed);
  return hostOf(backed?.matched_url ?? backed?.source_url) ?? alert.sources?.[0]?.domain ?? hostOf(alert.claims?.[0]?.source_url) ?? null;
}

export function fmtDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(s);
  if (!Number.isNaN(d.getTime()) && /\d{4}/.test(s)) {
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  }
  return s.length > 28 ? `${s.slice(0, 28)}...` : s;
}

function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(s);
  return Number.isNaN(d.getTime()) || !/\d{4}/.test(s) ? null : d;
}

// "since May 2, 2025" for past dates, "from Nov 18" for future ones, nothing for today.
export function effectiveLabel(s: string | null | undefined): string | null {
  const d = parseDay(s);
  if (!d) return null;
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (sameDay) return null;
  const text = fmtDate(s);
  if (!text) return null;
  return d.getTime() < today.getTime() ? `since ${text}` : `from ${text}`;
}

export function signedMoney(v: number, currency = "USD"): string {
  return `${v >= 0 ? "+" : "-"}${fmtMoney(Math.abs(v), currency)}`;
}

export function fmtShort(v: number): string {
  return fmtCompact(v).replace(/\.0k$/, "k");
}

export function trimNumber(v: number, digits = 1): string {
  const s = v.toFixed(digits);
  return s.replace(/\.0+$/, "");
}

// Alerts carry the PricingResult the server computed when they were raised; older
// alerts without one are recomputed from the same facts with the same function.
export function alertEconomics(alert: AlertRow, product: ProductRow | null | undefined, settings: Settings): Economics | null {
  if (!product || product.price == null) return null;
  const econ = economicsFromPricing(product.price, pricingForAlert(alert, product, settings));
  if (!econ) return null;
  econ.duty_delta_pct = alert.impact?.tariff_rate_change_pct ?? null;
  return econ;
}

export function weeklyDrag(econ: Economics | null): number {
  if (!econ || econ.weekly_drag == null) return 0;
  return econ.weekly_drag < 0 ? -econ.weekly_drag : 0;
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function sortAlerts(alerts: AlertRow[], products: Map<string, ProductRow>, settings: Settings): AlertRow[] {
  const drag = new Map(alerts.map((a) => [a.id, weeklyDrag(alertEconomics(a, products.get(a.product_id), settings))]));
  return [...alerts].sort((a, b) => {
    const s = (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3);
    if (s !== 0) return s;
    const d = (drag.get(b.id) ?? 0) - (drag.get(a.id) ?? 0);
    if (d !== 0) return d;
    return b.created_at.localeCompare(a.created_at);
  });
}

// Primitives

export function SrCard({ children, className, style, flush }: { children: ReactNode; className?: string; style?: CSSProperties; flush?: boolean }) {
  return (
    <div className={cx("sr-card", flush && "sr-card--flush", className)} style={style}>
      {children}
    </div>
  );
}

export function SectionHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="sr-section-head">
      <h2>{title}</h2>
      {aside ? <span className="sr-xs">{aside}</span> : null}
    </div>
  );
}

export function MetricCard({ label, value, delta, tone = "neutral" }: { label: string; value: ReactNode; delta?: ReactNode; tone?: Tone }) {
  return (
    <div className={cx("sr-metric", tone !== "neutral" && `sr-metric--${tone}`)}>
      <span className="sr-metric__label">{label}</span>
      <span className="sr-metric__value">{value}</span>
      {delta ? <span className="sr-metric__delta">{delta}</span> : <span className="sr-metric__delta">&nbsp;</span>}
    </div>
  );
}

export function StatusPill({ tone = "neutral", dot, live, caps = true, children, className, title }: { tone?: Tone; dot?: boolean; live?: boolean; caps?: boolean; children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cx("sr-pill", tone !== "neutral" && `sr-pill--${tone}`, !caps && "sr-pill--text", className)} title={title}>
      {dot || live ? <span className={cx("sr-pill__dot", live && "sr-pill__dot--live")} /> : null}
      {children}
    </span>
  );
}

export function ChipRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="sr-chips" role="tablist" aria-label={label}>
      {children}
    </div>
  );
}

export function Chip({ active, onClick, children, count }: { active?: boolean; onClick?: () => void; children: ReactNode; count?: number }) {
  return (
    <button type="button" role="tab" aria-selected={Boolean(active)} className={cx("sr-chip", active && "sr-chip--active")} onClick={onClick}>
      {children}
      {count != null ? <span className="sr-chip__count">{count}</span> : null}
    </button>
  );
}

export function AccentCard({ tone, children, className, style }: { tone: Tone; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx("sr-accent", `sr-accent--${tone}`, className)} style={style}>
      {children}
    </div>
  );
}

export function MetricGrid({ items }: { items: Array<{ label: string; value: ReactNode; old?: ReactNode; sub?: ReactNode; tone?: Tone }> }) {
  return (
    <div className="sr-metricgrid">
      {items.map((it, i) => (
        <div key={i} className="sr-stack" style={{ gap: 2 }}>
          <p className="sr-xs">{it.label}</p>
          <div className="sr-row" style={{ gap: 6, alignItems: "baseline" }}>
            <span className={cx("sr-metricgrid__value", it.tone && `sr-tone-${it.tone}`)}>{it.value}</span>
            {it.old ? <span className="sr-sm sr-strike sr-num">{it.old}</span> : null}
          </div>
          {it.sub ? (
            <p className={cx("sr-xs sr-num", it.tone && `sr-tone-${it.tone}`)} style={{ fontWeight: 600 }}>
              {it.sub}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function MarginBar({ keepPct, lostPct }: { keepPct: number; lostPct: number }) {
  const keep = Math.max(0, Math.min(100, keepPct));
  const lost = Math.max(0, Math.min(100 - keep, lostPct));
  return (
    <div className="sr-marginbar" role="img" aria-label={`${keep.toFixed(1)} percent margin kept, ${lost.toFixed(1)} percent lost`}>
      <span className="sr-marginbar__keep" style={{ width: `${keep}%` }} />
      <span className="sr-marginbar__lost" style={{ width: `${lost}%` }} />
    </div>
  );
}

export function ProgressRow({ label, value, pct, tone = "success", foot }: { label: ReactNode; value: ReactNode; pct: number | null; tone?: Tone; foot?: ReactNode }) {
  const width = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="sr-inset sr-stack sr-stack--tight">
      <div className="sr-row sr-row--between">
        <span className="sr-body sr-truncate" style={{ fontWeight: 500 }}>
          {label}
        </span>
        <span className="sr-body sr-num sr-right" style={{ fontWeight: 700 }}>
          {value}
        </span>
      </div>
      <div className={cx("sr-progress", tone === "critical" && "sr-progress--critical", tone === "warning" && "sr-progress--warning")}>
        <span style={{ width: `${width}%` }} />
      </div>
      {foot ? <div className="sr-row sr-row--between sr-xs">{foot}</div> : null}
    </div>
  );
}

export function AuditRow({ title, state, sub, children }: { title: string; state: "action" | "clear" | "pending"; sub?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const Icon = state === "action" ? AlertCircleIcon : state === "clear" ? CheckCircleIcon : ClockIcon;
  const color = state === "action" ? "var(--sr-critical)" : state === "clear" ? "var(--sr-primary)" : "var(--sr-text-2)";
  return (
    <div className="sr-audit">
      <button type="button" className="sr-audit__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="sr-audit__icon" style={{ color, fill: color }}>
          <Icon />
        </span>
        <span className="sr-grow">
          <span className="sr-body" style={{ fontWeight: 600, display: "block" }}>
            {title}
          </span>
          {sub ? (
            <span className={cx("sr-xs", state === "action" && "sr-tone-critical")} style={{ marginTop: 2, display: "block" }}>
              {sub}
            </span>
          ) : null}
        </span>
        {state === "action" ? <StatusPill tone="critical">Action needed</StatusPill> : state === "clear" ? <StatusPill tone="success">Nothing new</StatusPill> : <StatusPill>Not checked yet</StatusPill>}
      </button>
      {open && children ? <div className="sr-audit__body">{children}</div> : null}
    </div>
  );
}

export function RepriceBlock({ price, currency, preservedPct, retailDelta, explanation, onDraft, busy, done }: { price: number; currency: string; preservedPct: number | null; retailDelta: number | null; explanation?: string | null; onDraft: () => void; busy?: boolean; done?: boolean }) {
  return (
    <div className="sr-stack">
      <div className="sr-row sr-row--between sr-row--top">
        <div className="sr-grow">
          <p className="sr-xs">Recommended reprice</p>
          <p className="sr-h2 sr-num" style={{ marginTop: 2 }}>
            Adjust to {fmtMoney(price, currency)}{" "}
            <span className="sr-sm" style={{ fontWeight: 400 }}>
              {currency}
            </span>
          </p>
        </div>
        <div className="sr-right">
          {preservedPct != null ? (
            <p className="sr-xs sr-tone-success sr-num" style={{ fontWeight: 600 }}>
              Preserves {fmtPct(preservedPct)} margin
            </p>
          ) : null}
          {retailDelta != null ? <p className="sr-xs sr-num">{signedMoney(retailDelta, currency)} retail</p> : null}
        </div>
      </div>
      {explanation ? <p className="sr-xs">{explanation}</p> : null}
      <SrButton variant="primary" block onClick={onDraft} loading={busy} disabled={done}>
        {done ? "Price copied" : `Draft reprice (${fmtMoney(price, currency)})`}
      </SrButton>
    </div>
  );
}

export function PulseRow({ domain, checks, open, lastRun }: { domain: string; checks: number; open: number; lastRun: string | null }) {
  const tone: Tone = open > 0 ? "critical" : lastRun ? "success" : "neutral";
  return (
    <div className="sr-card sr-row sr-row--between" style={{ padding: "10px 12px" }}>
      <div className="sr-row sr-grow" style={{ gap: 10 }}>
        <span className={cx("sr-pulse-tile", `sr-pulse-tile--${tone}`)} aria-hidden>
          {domain.charAt(0).toUpperCase()}
        </span>
        <div className="sr-grow">
          <p className="sr-body sr-truncate" style={{ fontWeight: 600 }}>
            {domain}
          </p>
          <p className="sr-xs sr-truncate">
            {checks} check{checks === 1 ? "" : "s"}, {lastRun ? `last run ${timeAgo(lastRun)}` : "not run yet"}
          </p>
        </div>
      </div>
      {open > 0 ? (
        <StatusPill tone="critical">
          {open} open
        </StatusPill>
      ) : lastRun ? (
        <StatusPill tone="success">Clear</StatusPill>
      ) : (
        <StatusPill>Queued</StatusPill>
      )}
    </div>
  );
}

export function ProductThumb({ product, size = "md", className }: { product: Pick<ProductRow, "image_url" | "marketplace" | "title"> | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  // Listings sometimes hand us a tracking pixel instead of a photo; fall back
  // to the neutral tile when the image fails to load.
  const [broken, setBroken] = useState(false);
  const src = product?.image_url && !broken ? product.image_url : null;
  return (
    <span className={cx("sr-thumb", size === "lg" && "sr-thumb--lg", size === "sm" && "sr-thumb--sm", className)} aria-hidden>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth < 24) setBroken(true);
          }}
        />
      ) : (
        <span>{marketplaceLabel(product?.marketplace)}</span>
      )}
    </span>
  );
}

export function StatusStrip({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="sr-strip">
      <span className="sr-strip__dot" aria-hidden />
      <div className="sr-grow">
        <div className="sr-strip__title sr-truncate">{title}</div>
        {subtitle ? <div className="sr-xs sr-truncate">{subtitle}</div> : null}
      </div>
      {right}
    </div>
  );
}

export function SrButton({
  href,
  external,
  onClick,
  variant = "secondary",
  size,
  block,
  loading,
  disabled,
  children,
  type = "button",
  className,
  ariaLabel,
}: {
  href?: string;
  external?: boolean;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "critical" | "plain";
  size?: "lg";
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  children: ReactNode;
  type?: "button" | "submit";
  className?: string;
  ariaLabel?: string;
}) {
  const cls = cx("sr-btn", variant === "primary" && "sr-btn--primary", variant === "critical" && "sr-btn--critical", variant === "plain" && "sr-btn--plain", size === "lg" && "sr-btn--lg", block && "sr-btn--block", className);
  if (href && !disabled && !loading) {
    if (external) {
      return (
        <a className={cls} href={href} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel}>
          {children}
        </a>
      );
    }
    return (
      <NextLink className={cls} href={href} aria-label={ariaLabel}>
        {children}
      </NextLink>
    );
  }
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled || loading} aria-label={ariaLabel} aria-busy={loading || undefined}>
      {loading ? <span className="sr-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <NextLink href={href} className="sr-back">
      <ArrowLeftIcon />
      {children}
    </NextLink>
  );
}

export function KV({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="sr-rows">
      {rows.map(([k, v]) => (
        <div className="sr-kv" key={k}>
          <span>{k}</span>
          <span className="sr-num">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function Disclosure({ title, children, defaultOpen }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="sr-card sr-disclosure" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <ChevronDownIcon />
      </summary>
      <div className="sr-disclosure__body">{children}</div>
    </details>
  );
}

export function EmptyCard({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="sr-card sr-empty">
      <div className="sr-empty__title">{title}</div>
      {text ? <p className="sr-empty__text">{text}</p> : null}
      {children ? <div className="sr-empty__actions">{children}</div> : null}
    </div>
  );
}

export function Skeleton({ lines = 3, card = true }: { lines?: number; card?: boolean }) {
  const widths = ["62%", "88%", "44%", "76%", "58%"];
  const body = (
    <div className="sr-stack" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="sr-skel" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  );
  return card ? <div className="sr-card">{body}</div> : body;
}

// Composite: the feed groups open alerts by product, one card per product,
// each alert as a stacked row that reads: what changed, does it touch me, what to do.

export function groupAlertsByProduct(sorted: AlertRow[]): Array<{ productId: string; alerts: AlertRow[] }> {
  const groups: Array<{ productId: string; alerts: AlertRow[] }> = [];
  const index = new Map<string, number>();
  for (const a of sorted) {
    const i = index.get(a.product_id);
    if (i == null) {
      index.set(a.product_id, groups.length);
      groups.push({ productId: a.product_id, alerts: [a] });
    } else {
      groups[i].alerts.push(a);
    }
  }
  return groups;
}

export function AlertRowItem({ alert, product, settings, showProduct }: { alert: AlertRow; product?: ProductRow | null; settings?: Settings; showProduct?: boolean }) {
  const econ = alertEconomics(alert, product, settings);
  const tone = alertTone(alert);
  const color = toneColor(tone);
  const currency = product?.currency || settings?.currency || "USD";
  const domain = sourceDomain(alert);
  const drag = weeklyDrag(econ);
  const delta = alert.impact?.tariff_rate_change_pct ?? null;
  const when = effectiveLabel(alert.impact?.effective_date);
  const isOpen = alert.status === "new";
  const washTone = tone === "neutral" ? "info" : tone;

  const pill = !isOpen ? (
    <StatusPill tone={tone}>{alert.status === "actioned" ? "Done" : "Dismissed"}</StatusPill>
  ) : delta != null && delta !== 0 ? (
    <StatusPill tone={tone} dot>
      {delta > 0 ? "+" : ""}
      {trimNumber(delta)}% duty
    </StatusPill>
  ) : (
    <StatusPill tone={tone} dot>
      {alert.severity === "high" ? "High priority" : alert.severity === "medium" ? "Review" : "Low"}
    </StatusPill>
  );

  return (
    <div className="sr-alertrow">
      <div className="sr-row sr-row--between" style={{ gap: 8 }}>
        <div className="sr-row sr-row--wrap" style={{ gap: 6 }}>
          {pill}
          <span className="sr-xs">{FAMILY_SHORT[alert.family] ?? alert.family}</span>
          {showProduct && product ? <span className="sr-xs sr-truncate">{product.title}</span> : null}
        </div>
        <span className="sr-xs sr-num sr-right">{timeAgo(alert.created_at)}</span>
      </div>
      <p className="sr-body" style={{ fontWeight: 600, lineHeight: "18px" }}>
        {alert.headline}
      </p>
      <div className={cx("sr-wash", `sr-wash--${washTone}`, "sr-stack sr-stack--tight")}>
        {econ && econ.new_margin_pct != null ? (
          <p className="sr-xs sr-num">
            Margin {fmtPct(econ.margin_pct)} to{" "}
            <span style={{ fontWeight: 700, color }}>{fmtPct(econ.new_margin_pct)}</span> ({fmtPct(econ.margin_shift_pct, 1, true)}),{" "}
            <span style={{ fontWeight: 700, color }}>-{fmtMoney(drag, currency, 0)}</span> a week at {settings?.units_per_week ?? 20} units
            {when ? `, ${when}` : ""}
          </p>
        ) : (
          <p className="sr-xs">
            {alert.relevance === "affects" ? "Applies to this product" : "Might apply to this product"}
            {when ? `, ${when}` : ""}
          </p>
        )}
        <p className="sr-body" style={{ fontWeight: 500 }}>
          {alert.action?.title || "Review the change"}
        </p>
      </div>
      <div className="sr-actions">
        <span className="sr-xs sr-num sr-grow">
          {alert.proposed > 0 ? `${alert.backed} of ${alert.proposed} claims backed by ${domain ?? "the official source"}` : `Read from ${domain ?? "the official source"}`}
        </span>
        <div className="sr-actions__buttons">
          {product && showProduct ? <SrButton href={`/products/${product.id}`}>Inspect</SrButton> : null}
          <SrButton variant={isOpen ? "primary" : "secondary"} href={`/alerts/${alert.id}`}>
            {isOpen ? actionLabel(alert.action?.type) : "Open"}
          </SrButton>
        </div>
      </div>
    </div>
  );
}

export function PriorityGroup({ product, alerts, settings, fallbackTitle }: { product?: ProductRow | null; alerts: AlertRow[]; settings?: Settings; fallbackTitle?: string }) {
  const currency = product?.currency || settings?.currency || "USD";
  const openCount = alerts.filter((a) => a.status === "new").length;
  const title = product?.title ?? fallbackTitle ?? "Product";
  return (
    <article className="sr-card sr-card--flush" aria-label={title}>
      <div className="sr-group-head">
        <ProductThumb product={product} size="sm" />
        <div className="sr-grow" style={{ minWidth: 0 }}>
          {product ? (
            <NextLink href={`/products/${product.id}`} className="sr-group-title sr-truncate">
              {title}
            </NextLink>
          ) : (
            <span className="sr-group-title sr-truncate">{title}</span>
          )}
          <div className="sr-row" style={{ gap: 6, marginTop: 2 }}>
            <StatusPill caps={false}>{marketplaceLabel(product?.marketplace)}</StatusPill>
            <span className="sr-xs sr-num">{fmtMoney(product?.price ?? null, currency)}</span>
            {product?.profile?.hts_candidates?.[0]?.code ? <span className="sr-xs sr-num sr-truncate">HS {product.profile.hts_candidates[0].code}</span> : null}
          </div>
        </div>
        <div className="sr-row" style={{ gap: 8 }}>
          <StatusPill tone={openCount > 0 ? "critical" : "neutral"} caps={false}>
            {alerts.length} alert{alerts.length === 1 ? "" : "s"}
          </StatusPill>
          {product ? (
            <SrButton href={`/products/${product.id}`} ariaLabel={`Inspect ${title}`} className="sr-desktop-only">
              Inspect
            </SrButton>
          ) : null}
        </div>
      </div>
      <div className="sr-rows">
        {alerts.map((a) => (
          <AlertRowItem key={a.id} alert={a} product={product} settings={settings} />
        ))}
      </div>
    </article>
  );
}

// Mobile bottom tab bar (hidden at 768px and up by CSS)

export function BottomTabs({ openCount = 0 }: { openCount?: number }) {
  const pathname = usePathname() || "/";
  const tabs = [
    { href: "/products", label: "Inspector", Icon: ProductIcon, active: pathname.startsWith("/products") },
    { href: "/", label: "Watchlist", Icon: HomeIcon, active: pathname === "/" },
    { href: "/alerts", label: "Alerts", Icon: AlertTriangleIcon, active: pathname.startsWith("/alerts"), badge: openCount },
    { href: "/settings", label: "Settings", Icon: SettingsIcon, active: pathname.startsWith("/settings") || pathname.startsWith("/rules") || pathname.startsWith("/receipt") },
  ];
  return (
    <nav className="sr-tabs" aria-label="Primary">
      {tabs.map((t) => (
        <NextLink key={t.href} href={t.href} className={cx("sr-tab", t.active && "sr-tab--active")} aria-current={t.active ? "page" : undefined}>
          <t.Icon />
          {t.badge ? <span className="sr-tab__badge">{t.badge > 99 ? "99+" : t.badge}</span> : null}
          <span>{t.label}</span>
        </NextLink>
      ))}
    </nav>
  );
}

// Composite: the duty impact box used by the product HUD and the alert page

export function DutyImpact({ econ, tone, currency, units }: { econ: Economics; tone: Tone; currency: string; units: number }) {
  if (econ.new_landed_cost == null || econ.new_margin_pct == null || econ.unit_cost_delta == null || econ.duty_delta_pct == null) return null;
  const color = toneColor(tone);
  const drag = weeklyDrag(econ);
  const shift = econ.margin_shift_pct ?? 0;
  const delta = econ.duty_delta_pct;
  const toneClass = tone === "neutral" ? "info" : tone;
  return (
    <div className="sr-card sr-stack">
      <MetricGrid
        items={[
          { label: "Duty rate change", value: `${delta > 0 ? "+" : ""}${trimNumber(delta)} pts`, sub: delta > 0 ? "added to landed cost" : "taken off landed cost", tone },
          { label: "Landed cost per unit", value: fmtMoney(econ.new_landed_cost, currency), old: fmtMoney(econ.landed_cost, currency), sub: `${signedMoney(econ.unit_cost_delta, currency)} per unit`, tone },
        ]}
      />
      <div className="sr-stack sr-stack--tight">
        <div className="sr-row sr-row--between">
          <span className="sr-xs" style={{ fontWeight: 600, color: "var(--sr-text)" }}>
            Net margin
          </span>
          <span className="sr-body sr-num" style={{ fontWeight: 700, color }}>
            {fmtPct(econ.margin_pct)} to {fmtPct(econ.new_margin_pct)}{" "}
            <span className="sr-xs" style={{ fontWeight: 400 }}>
              ({fmtPct(shift, 1, true)})
            </span>
          </span>
        </div>
        <MarginBar keepPct={econ.new_margin_pct} lostPct={Math.max(0, econ.margin_pct - econ.new_margin_pct)} />
        <div className="sr-row sr-row--between sr-xs sr-num" style={{ gap: 12 }}>
          <span>
            Cost: {fmtMoney(econ.landed_cost, currency)} base {econ.unit_cost_delta >= 0 ? "+" : "-"} {fmtMoney(Math.abs(econ.unit_cost_delta), currency)} duty = <strong className="sr-strong">{fmtMoney(econ.new_landed_cost, currency)}</strong>
          </span>
          <span className="sr-right" style={{ fontWeight: 600, color }}>
            Margin {fmtPct(shift, 1, true)}
          </span>
        </div>
      </div>
      <div className={cx("sr-wash", `sr-wash--${toneClass}`, "sr-row sr-row--between")}>
        <div className="sr-grow">
          <p className="sr-xs" style={{ fontWeight: 600, color: "var(--sr-text)" }}>
            Projected weekly profit drag
          </p>
          <p className="sr-xs">Based on {units} units a week</p>
        </div>
        <p className="sr-num sr-right" style={{ fontSize: 15, fontWeight: 700, color }}>
          {drag > 0 ? "-" : "+"}
          {fmtMoney(Math.abs(econ.weekly_drag ?? 0), currency)}{" "}
          <span className="sr-xs" style={{ fontWeight: 400 }}>
            /wk
          </span>
        </p>
      </div>
    </div>
  );
}
