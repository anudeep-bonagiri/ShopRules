"use client";

import { Banner, Button } from "@shopify/polaris";
import NextLink from "next/link";
import { useMemo, useState } from "react";
import { api, timeAgo, useApi } from "@/lib/client";
import type { AccountRow, AlertRow, ForgeRow, ProductRow, RuleRow } from "@/lib/db";
import { nexusProgress, nexusSeed } from "@/lib/nexus";
import { dutyExposure, dutyPerUnit } from "@/lib/duty-exposure";
import { effectiveProfile, pricingProduct } from "@/lib/product";
import { DEFAULT_DUTIABLE_SHARE, DEFAULT_UNITS_PER_WEEK, landedCostFor } from "@/lib/pricing";
import type { NexusVerification } from "@/lib/nexus-crawl";
import {
  alertEconomics,
  Chip,
  ChipRow,
  EmptyCard,
  fmtDate,
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
  sourceDomain,
  SrButton,
  SrCard,
  StatusPill,
  weeklyDrag,
} from "@/components/stitch";
import { WatchForm } from "@/components/WatchForm";

type Health = { ok: boolean; tavily_mode: string; nemotron_configured: boolean; storage_configured: boolean; mode?: { store: "blob" | "local"; models: "live" | "canned"; tavily: "live" | "canned" } };
type Rule = RuleRow & { product_title: string };
type Family = "all" | "tariff" | "tax" | "safety" | "policy" | "price";
const FAMILIES: Family[] = ["all", "tariff", "tax", "safety", "policy", "price"];
const FAMILY_CHIP: Record<Family, string> = { all: "All alerts", tariff: "Tariffs", tax: "Sales tax", safety: "Product safety", policy: "Policy", price: "Price changes" };

export default function WatchlistPage() {
  const [busy, setBusy] = useState<"add" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyingNexus, setVerifyingNexus] = useState(false);

  async function verifyNexus() {
    setVerifyingNexus(true);
    setError(null);
    try {
      const r = await api<{ verifications: NexusVerification[]; errors: string[] }>("/api/nexus/verify", { method: "POST", json: {} });
      const ok = r.verifications.filter((v) => v.verified).length;
      setNotice(`Read ${r.verifications.length} state revenue site${r.verifications.length === 1 ? "" : "s"} with Tavily; ${ok} threshold${ok === 1 ? "" : "s"} verified from the page text.${r.errors.length ? ` ${r.errors.join("; ")}` : ""}`);
      nexusApi.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setVerifyingNexus(false);
    }
  }
  const [notice, setNotice] = useState<string | null>(null);
  const [family, setFamily] = useState<Family>("all");
  const [allPulse, setAllPulse] = useState(false);

  const products = useApi<{ products: ProductRow[] }>("/api/products");
  const alerts = useApi<{ alerts: AlertRow[] }>("/api/alerts?status=all");
  const rules = useApi<{ rules: Rule[] }>("/api/rules");
  const account = useApi<{ account: AccountRow }>("/api/account");
  const health = useApi<Health>("/api/health");
  const forges = useApi<{ forges: ForgeRow[] }>("/api/forges");
  const nexusApi = useApi<{ verifications: Record<string, NexusVerification> }>("/api/nexus");
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
  // Stacked duties already inside the landed cost of every imported product, per
  // week: the general rate read from the schedule plus the seed and set layers.
  const exposure = productList.reduce(
    (acc, p) => {
      const profile = effectiveProfile(p);
      const e = dutyExposure({ origin_country: profile.origin_country, heading: profile.hts_candidates?.[0]?.code ?? null, duty_rate: p.duty_rate ?? null, surcharge_pct: p.overrides?.duty_surcharge_pct ?? null });
      const pp = pricingProduct(p);
      const landed = landedCostFor(pp, settings);
      if (landed == null || e.known_pct <= 0) return acc;
      const weekly = dutyPerUnit(e, landed, pp.dutiable_share ?? settings?.dutiable_share ?? DEFAULT_DUTIABLE_SHARE) * (pp.units_per_week ?? settings?.units_per_week ?? DEFAULT_UNITS_PER_WEEK);
      return { weekly: acc.weekly + weekly, products: acc.products + 1, seeds: acc.seeds || e.layers.some((l) => l.status === "seed") };
    },
    { weekly: 0, products: 0, seeds: false },
  );
  const counts: Record<Family, number> = {
    all: openAlerts.length,
    tariff: openAlerts.filter((a) => a.family === "tariff").length,
    tax: openAlerts.filter((a) => a.family === "tax").length,
    safety: openAlerts.filter((a) => a.family === "safety").length,
    policy: openAlerts.filter((a) => a.family === "policy" && a.kind !== "price").length,
    price: openAlerts.filter((a) => a.kind === "price").length,
  };
  const visible = family === "all" ? openAlerts : family === "price" ? openAlerts.filter((a) => a.kind === "price") : openAlerts.filter((a) => a.family === family && a.kind !== "price");
  const loading = products.loading || alerts.loading;
  const productCount = productList.length;

  function refreshAll() {
    products.refresh();
    alerts.refresh();
    rules.refresh();
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

  // Nexus limits: one row per ship-to state. The threshold is the latest
  // verifier-backed value a tax check quoted from the revenue site, else the
  // seed. Sales come from the orders import (dollars and orders per year) or
  // the figures typed in Settings. Both tests are shown and the binding one named.
  const shipTo = settings?.ship_to_states ?? [];
  const thisYear = String(new Date().getUTCFullYear());
  const marketplaces = Array.from(new Set(productList.map((p) => p.marketplace)));
  const facilitators = marketplaces.filter((m) => m === "amazon" || m === "etsy").map((m) => (m === "amazon" ? "Amazon" : "Etsy"));
  const selfCollect = marketplaces.some((m) => m === "shopify" || m === "other");
  const nexus = shipTo.map((code) => {
    const seed = nexusSeed(code);
    const rule = ruleList
      .filter((r) => r.family === "tax" && r.state === code)
      .sort((a, b) => (b.last_run_at ?? "").localeCompare(a.last_run_at ?? ""))[0] ?? null;
    const ruleIds = new Set(ruleList.filter((r) => r.family === "tax" && r.state === code).map((r) => r.id));
    // Only a quote from the state's own revenue site can mark a threshold verified; a consultancy page never does.
    const onRevenueSite = (a: AlertRow) => {
      const dom = sourceDomain(a);
      return Boolean(dom && seed && (dom === seed.dor_domain || dom.endsWith(`.${seed.dor_domain}`)));
    };
    const verifiedAlert = allAlerts
      .filter((a) => a.family === "tax" && ruleIds.has(a.rule_id) && a.impact?.nexus_verified && a.impact.nexus && (a.impact.nexus.dollars != null || a.impact.nexus.transactions != null) && onRevenueSite(a))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    // Best source first: a threshold Tavily read on the revenue site itself, then a verifier-backed alert, then the seed.
    const crawl = nexusApi.data?.verifications[code];
    const crawled = crawl?.verified && crawl.parsed ? crawl : null;
    const threshold = crawled?.parsed
      ? { dollars: crawled.parsed.dollars, transactions: crawled.parsed.transactions, operator: crawled.parsed.operator }
      : (verifiedAlert?.impact.nexus ?? (seed ? { dollars: seed.dollars, transactions: seed.transactions, operator: seed.operator } : { dollars: null, transactions: null, operator: null }));
    const yearRow = settings?.state_sales_by_year?.[thisYear]?.[code];
    const typed = settings?.state_sales?.[code];
    const sales = yearRow?.dollars ?? (typeof typed === "number" && Number.isFinite(typed) ? typed : null);
    const transactions = yearRow?.orders ?? null;
    const progress = nexusProgress({ threshold, sales, transactions });
    const verified = crawled
      ? `verified ${fmtDate(crawled.checked_at) ?? ""} on ${crawled.sources[0]?.url ? new URL(crawled.sources[0].url).hostname.replace(/^www\./, "") : seed?.dor_domain ?? "the revenue site"} (Tavily ${crawled.method})${crawled.matches_seed ? "" : ", differs from the seed"}`
      : verifiedAlert
        ? `verified ${fmtDate(verifiedAlert.created_at) ?? ""} from ${sourceDomain(verifiedAlert) ?? seed?.dor_domain ?? "the revenue site"}`
        : crawl && !crawl.verified
          ? `seed value, revenue site checked ${fmtDate(crawl.checked_at) ?? ""} but no threshold parsed`
          : "seed value, last verified never";
    return { code, name: seed?.name ?? code, rule, seed, threshold, sales, transactions, progress, verified, alertId: verifiedAlert?.id ?? null, sourceUrl: crawled?.sources[0]?.url ?? null };
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

      {health.data?.mode?.models === "canned" ? (
        <Banner tone="info">
          <p>Demo mode: no NEBIUS_API_KEY on this server, so Nemotron answers come from recorded fixtures and the store is a local file. Checks, guardrails, and pricing run for real; set the keys in apps/web/.env.local for live sources.</p>
        </Banner>
      ) : health.data && (!health.data.nemotron_configured || !health.data.storage_configured) ? (
        <Banner tone="warning">
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
        ) : exposure.weekly > 0 ? (
          <MetricCard label="Duty exposure" value={fmtShort(exposure.weekly)} tone="warning" delta={`per week in stacked duties, ${exposure.products} product${exposure.products === 1 ? "" : "s"}${exposure.seeds ? ", seeds included" : ""}`} />
        ) : (
          <MetricCard label="Protected" value={alerts.data ? `+${fmtShort(protectedSum)}` : "..."} tone="success" delta={protectedSum > 0 ? "per week, repriced" : "no margin at risk"} />
        )}
      </div>

      {productCount > 0 ? (
        <SrCard style={{ padding: 10 }}>
          <WatchForm
            compact
            placeholder="Watch another listing: paste an Etsy, Shopify, or Amazon URL"
            buttonLabel="Watch"
            disabled={busy === "demo"}
            aside={
              <Button variant="plain" onClick={loadDemo} loading={busy === "demo"}>
                Load demo shop
              </Button>
            }
          />
        </SrCard>
      ) : (
        <SrCard className="sr-stack">
          <div>
            <h2 className="sr-h2">Watch a listing</h2>
            <p className="sr-sm" style={{ marginTop: 4 }}>
              Paste an Etsy, Shopify, or Amazon listing URL. Shop Rules reads the page, works out what the product is, and starts watching the duty, safety, tax, and policy rules that touch it.
            </p>
          </div>
          <WatchForm placeholder="https://www.etsy.com/listing/..." buttonLabel="Watch product" disabled={busy === "demo"} />
          <div className="sr-row sr-row--between sr-row--wrap">
            <span className="sr-xs">Or add the page you are on with the Chrome extension.</span>
            <Button variant="plain" onClick={loadDemo} loading={busy === "demo"}>
              Load demo shop
            </Button>
          </div>
        </SrCard>
      )}

      <ChipRow label="Filter alerts">
        {FAMILIES.map((f) => (
          <Chip key={f} active={family === f} count={counts[f]} onClick={() => setFamily(f)}>
            {FAMILY_CHIP[f]}
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
            <EmptyCard title={`No open ${FAMILY_CHIP[family].toLowerCase()}${family === "price" ? "" : " alerts"}`} text="Other alert types may still be waiting.">
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
        <SectionHead
          title="Nexus limits"
          aside={
            <span className="sr-row" style={{ gap: 10 }}>
              <span>{settings?.sales_import ? `Sales from your ${settings.sales_import.source === "shopify" ? "Shopify" : "Etsy"} orders export` : "Sales tax thresholds by state"}</span>
              {shipTo.length ? (
                <SrButton onClick={() => void verifyNexus()} loading={verifyingNexus} disabled={!account.data}>
                  Verify on the revenue sites
                </SrButton>
              ) : null}
            </span>
          }
        />
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
                  tone={n.progress.tone}
                  pct={n.progress.pct}
                  value={
                    n.threshold.dollars != null || n.threshold.transactions != null ? (
                      <>
                        {n.sales != null ? fmtShort(n.sales) : null}
                        {n.sales != null ? <span className="sr-sm"> / </span> : null}
                        {n.threshold.dollars != null ? fmtShort(n.threshold.dollars) : null}
                        {n.threshold.dollars != null && n.threshold.transactions != null ? <span className="sr-sm"> {n.threshold.operator === "and" ? "and" : "or"} </span> : null}
                        {n.threshold.transactions != null ? (
                          <>
                            {n.transactions != null ? `${n.transactions} / ` : ""}
                            {n.threshold.transactions} orders
                          </>
                        ) : null}
                      </>
                    ) : (
                      "No threshold on file"
                    )
                  }
                  foot={
                    <>
                      <span className="sr-grow" style={{ minWidth: 180 }}>
                        {facilitators.length ? `${facilitators.join(" and ")} collect for you here (marketplace facilitator)` : ""}
                        {facilitators.length && selfCollect ? ". " : ""}
                        {selfCollect || !facilitators.length ? (
                          <>
                            You collect:{" "}
                            {n.seed ? (
                              <a className="sr-link" href={n.seed.source_url} target="_blank" rel="noopener noreferrer">
                                register at {n.seed.dor_domain}
                              </a>
                            ) : (
                              "register with the state"
                            )}
                          </>
                        ) : null}
                      </span>
                      {n.sales == null ? (
                        <NextLink href="/settings" className="sr-link">
                          Add sales
                        </NextLink>
                      ) : (
                        <span className={n.progress.tone === "critical" ? "sr-tone-critical" : n.progress.tone === "warning" ? "sr-tone-warning" : undefined} style={{ fontWeight: 600 }}>
                          {n.progress.summary}
                        </span>
                      )}
                    </>
                  }
                />
              ))}
            </div>
            <div className="sr-row sr-row--wrap sr-xs" style={{ gap: "4px 12px" }}>
              {nexus.map((n) => (
                <span key={n.code} className="sr-num">
                  {n.code}:{" "}
                  {n.sourceUrl ? (
                    <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer" className="sr-link">
                      {n.verified}
                    </a>
                  ) : n.alertId ? (
                    <NextLink href={`/alerts/${n.alertId}`} className="sr-link">
                      {n.verified}
                    </NextLink>
                  ) : (
                    n.verified
                  )}
                </span>
              ))}
            </div>
            <p className="sr-xs">Seed thresholds are labelled seeds until Tavily reads the state revenue site (Map finds the remote-seller pages, Extract reads them, a parser pulls the dollar and transaction tests with the quote). Amazon and Etsy collect for you as marketplace facilitators; sales from your own store count toward your own registration.</p>
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
