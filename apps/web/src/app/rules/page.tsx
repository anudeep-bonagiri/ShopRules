"use client";

import { Select } from "@shopify/polaris";
import NextLink from "next/link";
import { useMemo, useState } from "react";
import { api, timeAgo, useApi } from "@/lib/client";
import type { AlertRow, RuleRow } from "@/lib/db";
import { FAMILY_LABEL } from "@/lib/rules-catalog";
import { Chip, ChipRow, EmptyCard, FAMILY_SHORT, PageError, SectionHead, Skeleton, SrButton, SrCard, StatusPill } from "@/components/stitch";

type Rule = RuleRow & { product_title: string };
type Family = "all" | "tariff" | "tax" | "safety" | "policy";
const FAMILIES: Family[] = ["all", "tariff", "tax", "safety", "policy"];

const FAMILY_BLURB: Record<string, string> = {
  tariff: "CBP, USTR, the Federal Register, trade.gov, and the HTS. Origin, Section 301, de minimis, and the HTS heading the classifier proposed.",
  safety: "CPSC, FDA, FTC, FCC, and OEHHA for Prop 65. Seeded from what the product is: items for children, cosmetics, batteries, textiles, food contact.",
  tax: "The revenue site of each state you ship to. Economic nexus thresholds and marketplace facilitator rules.",
  policy: "Seller Central, Etsy Help, and Shopify Help for category policy changes.",
};

const CADENCE_OPTIONS = [
  { label: "Daily", value: "24" },
  { label: "Every 3 days", value: "72" },
  { label: "Weekly", value: "168" },
];

function cadenceValue(hours: number): string {
  if (hours <= 24) return "24";
  if (hours <= 72) return "72";
  return "168";
}

export default function RulesPage() {
  const list = useApi<{ rules: Rule[] }>("/api/rules");
  const alerts = useApi<{ alerts: AlertRow[] }>("/api/alerts?status=all");
  const { data, loading } = list;
  const [family, setFamily] = useState<Family>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rules = useMemo(() => data?.rules ?? [], [data]);
  const lastAlertByRule = useMemo(() => {
    const m = new Map<string, AlertRow>();
    for (const a of alerts.data?.alerts ?? []) {
      const cur = m.get(a.rule_id);
      if (!cur || a.created_at > cur.created_at) m.set(a.rule_id, a);
    }
    return m;
  }, [alerts.data]);
  const counts: Record<Family, number> = {
    all: rules.length,
    tariff: rules.filter((r) => r.family === "tariff").length,
    tax: rules.filter((r) => r.family === "tax").length,
    safety: rules.filter((r) => r.family === "safety").length,
    policy: rules.filter((r) => r.family === "policy").length,
  };
  const paused = rules.filter((r) => r.paused).length;
  const visible = (family === "all" ? rules : rules.filter((r) => r.family === family)).slice().sort((a, b) => (b.last_run_at ?? "").localeCompare(a.last_run_at ?? ""));
  // One card per product, products in order of their most recently run rule.
  const groups = (() => {
    const out: Array<{ productId: string; title: string; rules: typeof visible }> = [];
    for (const r of visible) {
      let g = out.find((x) => x.productId === r.product_id);
      if (!g) {
        g = { productId: r.product_id, title: r.product_title || "Product", rules: [] };
        out.push(g);
      }
      g.rules.push(r);
    }
    return out;
  })();

  async function patch(rule: Rule, body: { paused?: boolean; cadence_hours?: number }, done: string) {
    setBusy(rule.id);
    setError(null);
    try {
      const r = await api<{ rule: RuleRow }>(`/api/rules/${rule.id}`, { method: "PATCH", json: body });
      list.setData((prev) => (prev ? { rules: prev.rules.map((x) => (x.id === rule.id ? { ...x, ...r.rule } : x)) } : prev));
      setNotice(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (list.error) return <PageError title="Watch rules" subtitle="What Shop Rules checks, where, and how often." error={list.error ?? ""} status={list.status} onRetry={list.refresh} />;

  return (
    <div className="sr-page">
      <div className="sr-topline">
        <div className="sr-grow">
          <h1 className="sr-h1">Watch rules</h1>
          <p className="sr-sm" style={{ marginTop: 4 }}>
            What Shop Rules checks, where, and how often. Seed values are starting points; every alert quotes the live page.
          </p>
        </div>
        {data ? (
          <StatusPill tone={rules.length ? "success" : "neutral"} caps={false}>
            {rules.length} rule{rules.length === 1 ? "" : "s"}
            {paused ? `, ${paused} paused` : ""}
          </StatusPill>
        ) : null}
      </div>

      {notice ? (
        <p className="sr-wash sr-wash--success sr-xs" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="sr-wash sr-wash--critical sr-xs" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sr-grid-2 sr-grid-2--tight">
        {(["tariff", "safety", "tax", "policy"] as const).map((f) => (
          <SrCard key={f} className="sr-stack sr-stack--tight">
            <div>
              <StatusPill>{FAMILY_LABEL[f]}</StatusPill>
            </div>
            <p className="sr-xs">{FAMILY_BLURB[f]}</p>
          </SrCard>
        ))}
      </div>

      <ChipRow label="Filter rules">
        {FAMILIES.map((f) => (
          <Chip key={f} active={family === f} count={counts[f]} onClick={() => setFamily(f)}>
            {f === "all" ? "All rules" : FAMILY_SHORT[f]}
          </Chip>
        ))}
      </ChipRow>

      <section className="sr-stack">
        <SectionHead title="Rules" aside={visible.length ? "Most recently run first. Pause a rule to skip it; the cadence is how often it runs." : undefined} />
        {loading ? (
          <Skeleton lines={4} />
        ) : rules.length === 0 ? (
          <EmptyCard title="No rules yet" text="Watch a product and its rules appear here: tariffs by origin and HTS code, safety rules by what the product is, nexus thresholds by state, and marketplace policy.">
            <SrButton href="/">Watch a product</SrButton>
          </EmptyCard>
        ) : visible.length === 0 ? (
          <EmptyCard title={`No ${FAMILY_SHORT[family].toLowerCase()} rules`} text="Other rule types are still watched.">
            <SrButton onClick={() => setFamily("all")}>Show all rules</SrButton>
          </EmptyCard>
        ) : (
          <div className="sr-stack">
            {groups.map((g) => (
              <SrCard key={g.productId} flush>
                <div className="sr-group-head">
                  <div className="sr-grow" style={{ minWidth: 0 }}>
                    <NextLink href={`/products/${g.productId}`} className="sr-group-title sr-truncate">
                      {g.title}
                    </NextLink>
                    <p className="sr-xs sr-num" style={{ marginTop: 2 }}>
                      {g.rules.length} rule{g.rules.length === 1 ? "" : "s"}, {g.rules.filter((r) => r.last_run_at).length} checked, {g.rules.filter((r) => r.paused).length} paused
                    </p>
                  </div>
                  <StatusPill tone={g.rules.some((r) => lastAlertByRule.get(r.id)?.status === "new") ? "critical" : "neutral"} caps={false}>
                    {g.rules.filter((r) => lastAlertByRule.get(r.id)?.status === "new").length} open alert{g.rules.filter((r) => lastAlertByRule.get(r.id)?.status === "new").length === 1 ? "" : "s"}
                  </StatusPill>
                </div>
            <div className="sr-rows">
              {g.rules.map((r) => {
                const last = lastAlertByRule.get(r.id);
                return (
                  <div key={r.id} className="sr-stack" style={{ padding: "12px 14px", gap: 6, opacity: r.paused ? 0.75 : 1 }}>
                    <div className="sr-row sr-row--between sr-row--wrap" style={{ gap: 8 }}>
                      <span className="sr-body" style={{ fontWeight: 600 }}>
                        {r.title}
                      </span>
                      <div className="sr-row sr-row--wrap" style={{ gap: 6 }}>
                        <StatusPill>{FAMILY_SHORT[r.family]}</StatusPill>
                        {r.paused ? <StatusPill tone="warning">Paused</StatusPill> : r.last_run_at ? <StatusPill tone="success">Checked</StatusPill> : <StatusPill>Queued</StatusPill>}
                      </div>
                    </div>
                    <NextLink href={`/products/${r.product_id}`} className="sr-link" style={{ fontSize: 12, display: "block" }}>
                      {r.product_title || "Product"}
                    </NextLink>
                    <p className="sr-xs sr-num">
                      {r.include_domains.join(", ")}. Last run {timeAgo(r.last_run_at)}.
                    </p>
                    {r.last_headline ? (
                      <p className="sr-xs">
                        Last finding:{" "}
                        {last ? (
                          <NextLink href={`/alerts/${last.id}`} className="sr-link">
                            {r.last_headline}
                          </NextLink>
                        ) : (
                          r.last_headline
                        )}
                      </p>
                    ) : null}
                    <div className="sr-row sr-row--between sr-row--wrap" style={{ gap: 8 }}>
                      <div style={{ minWidth: 160 }}>
                        <Select label={`Cadence for ${r.title}`} labelHidden options={CADENCE_OPTIONS} value={cadenceValue(r.cadence_hours)} disabled={busy === r.id} onChange={(v) => void patch(r, { cadence_hours: Number(v) }, `${r.title} now runs ${CADENCE_OPTIONS.find((o) => o.value === v)?.label.toLowerCase() ?? "on the new cadence"}.`)} />
                      </div>
                      <SrButton variant={r.paused ? "primary" : "secondary"} loading={busy === r.id} disabled={busy != null && busy !== r.id} onClick={() => void patch(r, { paused: !r.paused }, r.paused ? `${r.title} resumed.` : `${r.title} paused. Checks and the daily schedule skip it until you resume.`)} aria-pressed={Boolean(r.paused)}>
                        {r.paused ? "Resume" : "Pause"}
                      </SrButton>
                    </div>
                  </div>
                );
              })}
            </div>
              </SrCard>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
