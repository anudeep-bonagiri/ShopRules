"use client";

import { Banner, Button, TextField } from "@shopify/polaris";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, timeAgo, useApi } from "@/lib/client";
import type { AccountRow, AlertRow, ForgeRow, ProductRow, RuleRow } from "@/lib/db";
import { thresholdAmount } from "@/lib/economics";
import { STATES } from "@/lib/rules-catalog";
import {
  alertEconomics,
  Chip,
  ChipRow,
  EmptyCard,
  PageError,
  FAMILY_SHORT,
  fmtShort,
  groupAlertsByProduct,
  MetricCard,
  PriorityGroup,
  ProgressRow,
  PulseRow,
  SectionHead,
  Skeleton,
  sortAlerts,
  SrButton,
  SrCard,
  StatusPill,
  weeklyDrag,
  type Tone,
} from "@/components/stitch";

type Health = { ok: boolean; tavily_mode: string; nemotron_configured: boolean; storage_configured: boolean };
type Rule = RuleRow & { product_title: string };
type Family = "all" | "tariff" | "tax" | "safety" | "policy";
const FAMILIES: Family[] = ["all", "tariff", "tax", "safety", "policy"];

export default function WatchlistPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"add" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [family, setFamily] = useState<Family>("all");
  const [allPulse, setAllPulse] = useState(false);

  const products = useApi<{ products: ProductRow[] }>("/api/products");
  const alerts = useApi<{ alerts: AlertRow[] }>("/api/alerts?status=all");
  const rules = useApi<{ rules: Rule[] }>("/api/rules");
  const account = useApi<{ account: AccountRow }>("/api/account");
  const health = useApi<Health>("/api/health");
  const forges = useApi<{ forges: ForgeRow[] }>("/api/forges");
  const forgeCount = forges.data?.forges.length ?? 0;
  const forgePassing = forges.data?.forges.filter((f) => f.status === "passed").length ?? 0;

  const settings = account.data?.account.settings;
  const productList = useMemo(() => products.data?.products ?? [], [products.data]);
  const productMap = useMemo(() => new Map(productList.map((p) => [p.id, p])), [productList]);
  const allAlerts = useMemo(() => alerts.data?.alerts ?? [], [alerts.data]);
  const openAlerts = useMemo(() => sortAlerts(allAlerts.filter((a) => a.status === "new"), productMap, settings), [allAlerts, productMap, settings]);
  const ruleList = useMemo(() => rules.data?.rules ?? [], [rules.data]);

  const dragOpen = openAlerts.reduce((s, a) => s + weeklyDrag(alertEconomics(a, productMap.get(a.product_id), settings)), 0);
  const protectedSum = allAlerts.filter((a) => a.status === "actioned").reduce((s, a) => s + weeklyDrag(alertEconomics(a, productMap.get(a.product_id), settings)), 0);
  const highCount = openAlerts.filter((a) => a.severity === "high").length;
  const counts: Record<Family, number> = {
    all: openAlerts.length,
    tariff: openAlerts.filter((a) => a.family === "tariff").length,
    tax: openAlerts.filter((a) => a.family === "tax").length,
    safety: openAlerts.filter((a) => a.family === "safety").length,
    policy: openAlerts.filter((a) => a.family === "policy").length,
  };
  const visible = family === "all" ? openAlerts : openAlerts.filter((a) => a.family === family);
  const loading = products.loading || alerts.loading;
  const productCount = productList.length;

  function refreshAll() {
    products.refresh();
    alerts.refresh();
    rules.refresh();
  }

  async function addListing() {
    if (!url.trim()) return;
    setBusy("add");
    setError(null);
    try {
      const r = await api<{ product: ProductRow; existing: boolean }>("/api/products", { method: "POST", json: { url: url.trim() } });
      router.push(`/products/${r.product.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function loadDemo() {
    setBusy("demo");
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ products: ProductRow[]; alerts: number; errors: string[] }>("/api/demo/seed", { method: "POST" });
      setNotice(`Loaded ${r.products.length} demo listing${r.products.length === 1 ? "" : "s"} and found ${r.alerts} alert${r.alerts === 1 ? "" : "s"} on the first check.${r.errors.length ? ` ${r.errors.length} check${r.errors.length === 1 ? "" : "s"} could not run and will retry on the next schedule.` : ""}`);
      refreshAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Nexus limits: one row per ship-to state, read from that state's tax rule.
  const shipTo = settings?.ship_to_states ?? [];
  const nexus = shipTo.map((code) => {
    const st = STATES.find((s) => s.code === code);
    const rule = ruleList
      .filter((r) => r.family === "tax" && r.state === code)
      .sort((a, b) => (b.last_run_at ?? "").localeCompare(a.last_run_at ?? ""))[0] ?? null;
    const note = rule ? rule.seed_note : st?.threshold_note ?? null;
    const threshold = thresholdAmount(note);
    const salesRaw = settings?.state_sales?.[code];
    const sales = typeof salesRaw === "number" && Number.isFinite(salesRaw) ? salesRaw : null;
    const collector = rule?.seed_note?.match(/^(Amazon|Etsy) collects/)?.[1] ?? null;
    const pct = sales != null && threshold ? (sales / threshold) * 100 : null;
    const tone: Tone = pct == null ? "success" : pct >= 100 ? "critical" : pct >= 80 ? "warning" : "success";
    return { code, name: st?.name ?? code, rule, threshold, sales, collector, pct, tone };
  });

  // Regulatory pulse: the official domains being watched, grouped.
  const pulse = useMemo(() => {
    const groups = new Map<string, { domain: string; checks: number; ruleIds: Set<string>; last: string | null }>();
    for (const r of ruleList) {
      const domain = r.include_domains?.[0] ?? "official source";
      const g = groups.get(domain) ?? { domain, checks: 0, ruleIds: new Set<string>(), last: null };
      g.checks += 1;
      g.ruleIds.add(r.id);
      if (r.last_run_at && (!g.last || r.last_run_at > g.last)) g.last = r.last_run_at;
      groups.set(domain, g);
    }
    return Array.from(groups.values())
      .map((g) => ({ domain: g.domain, checks: g.checks, last: g.last, open: openAlerts.filter((a) => g.ruleIds.has(a.rule_id)).length }))
      .sort((a, b) => b.open - a.open || b.checks - a.checks || a.domain.localeCompare(b.domain));
  }, [ruleList, openAlerts]);
  const lastRun = pulse.reduce<string | null>((m, p) => (p.last && (!m || p.last > m) ? p.last : m), null);
  const pulseShown = allPulse ? pulse : pulse.slice(0, 6);

  if (products.error) return <PageError title="Watchlist" subtitle="What changed for the products you sell, checked against the official source." error={products.error ?? ""} status={products.status} onRetry={() => { products.refresh(); alerts.refresh(); rules.refresh(); account.refresh(); }} />;

  return (
    <div className="sr-page">
      <div className="sr-topline">
        <div className="sr-grow">
          <h1 className="sr-h1">Watchlist</h1>
          <p className="sr-sm" style={{ marginTop: 4 }}>
            What changed for the products you sell, checked against the official source.
          </p>
        </div>
        {products.data ? (
          productCount > 0 ? (
            <StatusPill tone="success" live caps={false}>
              Connected: {productCount} product{productCount === 1 ? "" : "s"}, live checks
            </StatusPill>
          ) : (
            <StatusPill caps={false}>Not watching anything yet</StatusPill>
          )
        ) : null}
      </div>

      {health.data && (!health.data.nemotron_configured || !health.data.storage_configured) ? (
        <Banner tone="warning" title="Setup incomplete">
          <p>
            {!health.data.storage_configured ? "Storage is not configured (BLOB_READ_WRITE_TOKEN). " : ""}
            {!health.data.nemotron_configured ? "Nemotron on Nebius Token Factory is not configured (NEBIUS_API_KEY). Checks will fail until it is set." : ""}
          </p>
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="critical" title="Something went wrong" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      ) : null}
      {busy === "demo" ? (
        <Banner tone="info" title="Loading the demo shop">
          <p>Three listings are being read and classified, their watch rules seeded, and the first check run against the official sources. This takes about a minute.</p>
        </Banner>
      ) : null}
      {notice ? (
        <Banner tone="success" onDismiss={() => setNotice(null)}>
          <p>{notice}</p>
        </Banner>
      ) : null}

      <div className="sr-metrics">
        <MetricCard label="Monitored" value={products.data ? productCount : "..."} delta={productCount > 0 ? `${ruleList.length} live check${ruleList.length === 1 ? "" : "s"}` : "No products yet"} />
        <MetricCard label="Needs action" value={alerts.data ? openAlerts.length : "..."} tone={openAlerts.length > 0 ? "critical" : "neutral"} delta={openAlerts.length > 0 ? `${highCount} high priority` : "Nothing waiting"} />
        {dragOpen > 0 ? (
          <MetricCard label="At stake" value={`-${fmtShort(dragOpen)}`} tone="warning" delta="margin drag per week" />
        ) : (
          <MetricCard label="Protected" value={alerts.data ? `+${fmtShort(protectedSum)}` : "..."} tone="success" delta={protectedSum > 0 ? "per week, repriced" : "no margin at risk"} />
        )}
      </div>

      {productCount > 0 ? (
        <SrCard className="sr-row sr-row--wrap" style={{ padding: 10, gap: 8 }}>
          <div className="sr-grow" style={{ minWidth: 240 }}>
            <TextField
              label="Listing URL"
              labelHidden
              value={url}
              onChange={setUrl}
              autoComplete="off"
              placeholder="Watch another listing: paste an Etsy, Shopify, or Amazon URL"
              clearButton
              onClearButtonClick={() => setUrl("")}
              connectedRight={
                <Button variant="primary" onClick={addListing} loading={busy === "add"} disabled={!url.trim() || busy === "demo"}>
                  Watch
                </Button>
              }
            />
          </div>
          <Button variant="plain" onClick={loadDemo} loading={busy === "demo"} disabled={busy === "add"}>
            Load demo shop
          </Button>
        </SrCard>
      ) : (
        <SrCard className="sr-stack">
          <div>
            <h2 className="sr-h2">Watch a listing</h2>
            <p className="sr-sm" style={{ marginTop: 4 }}>
              Paste an Etsy, Shopify, or Amazon listing URL. Shop Rules reads the page, works out what the product is, and starts watching the duty, safety, tax, and policy rules that touch it.
            </p>
          </div>
          <TextField
            label="Listing URL"
            labelHidden
            value={url}
            onChange={setUrl}
            autoComplete="off"
            placeholder="https://www.etsy.com/listing/..."
            clearButton
            onClearButtonClick={() => setUrl("")}
            connectedRight={
              <Button variant="primary" onClick={addListing} loading={busy === "add"} disabled={!url.trim() || busy === "demo"}>
                Watch product
              </Button>
            }
          />
          <div className="sr-row sr-row--between sr-row--wrap">
            <span className="sr-xs">Or add the page you are on with the Chrome extension.</span>
            <Button variant="plain" onClick={loadDemo} loading={busy === "demo"} disabled={busy === "add"}>
              Load demo shop
            </Button>
          </div>
        </SrCard>
      )}

      <ChipRow label="Filter alerts">
        {FAMILIES.map((f) => (
          <Chip key={f} active={family === f} count={counts[f]} onClick={() => setFamily(f)}>
            {f === "all" ? "All alerts" : FAMILY_SHORT[f]}
          </Chip>
        ))}
      </ChipRow>

      <section className="sr-stack">
        <SectionHead title="Priority" aside={visible.length > 1 ? "One card per product, by severity then weekly margin drag" : undefined} />
        {loading ? (
          <Skeleton lines={4} />
        ) : productCount === 0 ? (
          <EmptyCard title="Nothing to watch yet" text="Paste a listing above, or load the demo shop to see three products with live checks and a real alert.">
            <Button variant="primary" onClick={loadDemo} loading={busy === "demo"}>
              Load demo shop
            </Button>
          </EmptyCard>
        ) : visible.length === 0 ? (
          family === "all" ? (
            <EmptyCard title="All clear" text={`${productCount} product${productCount === 1 ? "" : "s"} watched, no open alerts. Checks run on their own schedule. Open a product to run one now.`}>
              <SrButton href="/products">Open Inspector</SrButton>
            </EmptyCard>
          ) : (
            <EmptyCard title={`No open ${FAMILY_SHORT[family].toLowerCase()} alerts`} text="Other alert types may still be waiting.">
              <SrButton onClick={() => setFamily("all")}>Show all alerts</SrButton>
            </EmptyCard>
          )
        ) : (
          <div className="sr-priority">
            {groupAlertsByProduct(visible).map((g) => (
              <PriorityGroup key={g.productId} product={productMap.get(g.productId)} alerts={g.alerts} settings={settings} fallbackTitle={g.alerts[0]?.product_title} />
            ))}
          </div>
        )}
      </section>

      <section className="sr-stack">
        <SectionHead title="Nexus limits" aside="Sales tax thresholds by state" />
        {!account.data ? (
          <Skeleton lines={2} />
        ) : shipTo.length === 0 ? (
          <EmptyCard title="No ship-to states yet" text="Pick the states most of your orders go to. Shop Rules watches each state revenue site for its nexus threshold and tells you who collects.">
            <SrButton href="/settings">Choose states</SrButton>
          </EmptyCard>
        ) : (
          <SrCard className="sr-stack">
            <div className="sr-grid-2">
              {nexus.map((n) => (
                <ProgressRow
                key={n.code}
                label={`${n.name} nexus limit`}
                tone={n.tone}
                pct={n.pct}
                value={
                  n.sales != null ? (
                    <>
                      {fmtShort(n.sales)} <span className="sr-sm">/ {n.threshold ? fmtShort(n.threshold) : "live limit"}</span>
                    </>
                  ) : n.threshold ? (
                    <>
                      {fmtShort(n.threshold)} <span className="sr-sm">limit</span>
                    </>
                  ) : (
                    "Verified live"
                  )
                }
                foot={
                  <>
                    <span className="sr-truncate">{n.collector ? `${n.collector} collects for you here` : n.rule ? "You register once you cross the limit" : "Marketplace sellers are usually covered"}</span>
                    {n.rule && n.threshold == null ? (
                      <span>verified live</span>
                    ) : n.sales == null ? (
                      <NextLink href="/settings" className="sr-link">
                        Set sales
                      </NextLink>
                    ) : n.pct != null ? (
                      <span className={n.tone === "critical" ? "sr-tone-critical" : n.tone === "warning" ? "sr-tone-warning" : undefined} style={{ fontWeight: 600 }}>
                        {n.pct >= 100 ? "Over the limit" : `${Math.round(n.pct)}% of limit`}
                      </span>
                    ) : null}
                  </>
                }
              />
              ))}
            </div>
            <p className="sr-xs">Thresholds come from each state revenue site. Amazon and Etsy collect for you as marketplace facilitators; Shopify sellers register themselves.</p>
          </SrCard>
        )}
      </section>

      <section className="sr-stack">
        <SectionHead title="Regulatory pulse" aside={lastRun ? `Updated ${timeAgo(lastRun)}` : undefined} />
        {rules.loading ? (
          <Skeleton lines={2} />
        ) : pulse.length === 0 ? (
          <EmptyCard title="No sources watched yet" text="Watch a product and the official sources it depends on appear here: CBP, USTR, the Federal Register, CPSC, FDA, and the state revenue sites you ship to." />
        ) : (
          <>
            <div className="sr-grid-pulse">
              {pulseShown.map((p) => (
                <PulseRow key={p.domain} domain={p.domain} checks={p.checks} open={p.open} lastRun={p.last} />
              ))}
            </div>
            {pulse.length > 6 ? (
              <div>
                <SrButton variant="plain" onClick={() => setAllPulse((v) => !v)}>
                  {allPulse ? "Show fewer" : `Show all ${pulse.length} sources`}
                </SrButton>
              </div>
            ) : null}
            <p className="sr-xs">
              Every alert quotes the official page. A verifier outside the model drops any claim whose quote is not in the text it read.
              {forgeCount > 0 ? ` Plus ${forgeCount} check${forgeCount === 1 ? "" : "s"} as code, ${forgePassing} passing.` : ""}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
