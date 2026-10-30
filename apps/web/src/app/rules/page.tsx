"use client";

import NextLink from "next/link";
import { useMemo, useState } from "react";
import { timeAgo, useApi } from "@/lib/client";
import type { RuleRow } from "@/lib/db";
import { FAMILY_LABEL } from "@/lib/rules-catalog";
import { Chip, ChipRow, EmptyCard, FAMILY_SHORT, SectionHead, Skeleton, SrButton, SrCard, StatusPill } from "@/components/stitch";

type Rule = RuleRow & { product_title: string };
type Family = "all" | "tariff" | "tax" | "safety" | "policy";
const FAMILIES: Family[] = ["all", "tariff", "tax", "safety", "policy"];

const FAMILY_BLURB: Record<string, string> = {
  tariff: "CBP, USTR, the Federal Register, trade.gov, and the HTS. Origin, Section 301, de minimis, and the HTS heading the classifier proposed.",
  safety: "CPSC, FDA, FTC, FCC, and OEHHA for Prop 65. Seeded from what the product is: items for children, cosmetics, batteries, textiles, food contact.",
  tax: "The revenue site of each state you ship to. Economic nexus thresholds and marketplace facilitator rules.",
  policy: "Seller Central, Etsy Help, and Shopify Help for category policy changes.",
};

export default function RulesPage() {
  const { data, loading } = useApi<{ rules: Rule[] }>("/api/rules");
  const [family, setFamily] = useState<Family>("all");
  const rules = useMemo(() => data?.rules ?? [], [data]);
  const counts: Record<Family, number> = {
    all: rules.length,
    tariff: rules.filter((r) => r.family === "tariff").length,
    tax: rules.filter((r) => r.family === "tax").length,
    safety: rules.filter((r) => r.family === "safety").length,
    policy: rules.filter((r) => r.family === "policy").length,
  };
  const visible = (family === "all" ? rules : rules.filter((r) => r.family === family)).slice().sort((a, b) => (b.last_run_at ?? "").localeCompare(a.last_run_at ?? ""));

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
          </StatusPill>
        ) : null}
      </div>

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
        <SectionHead title="Rules" aside={visible.length ? "Most recently run first" : undefined} />
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
          <SrCard flush>
            <div className="sr-rows">
              {visible.map((r) => (
                <div key={r.id} className="sr-stack" style={{ padding: "12px 14px", gap: 4 }}>
                  <div className="sr-row sr-row--between" style={{ gap: 8 }}>
                    <span className="sr-body sr-truncate" style={{ fontWeight: 600 }}>
                      {r.title}
                    </span>
                    <div className="sr-row" style={{ gap: 6 }}>
                      <StatusPill>{FAMILY_SHORT[r.family]}</StatusPill>
                      {r.last_run_at ? <StatusPill tone="success">Checked</StatusPill> : <StatusPill>Queued</StatusPill>}
                    </div>
                  </div>
                  <NextLink href={`/products/${r.product_id}`} className="sr-link sr-truncate" style={{ fontSize: 12, display: "block" }}>
                    {r.product_title || "Product"}
                  </NextLink>
                  <p className="sr-xs sr-num sr-truncate">
                    {r.include_domains.join(", ")}. Every {r.cadence_hours} h, last run {timeAgo(r.last_run_at)}.
                  </p>
                  {r.last_headline ? <p className="sr-xs">Last finding: {r.last_headline}</p> : null}
                </div>
              ))}
            </div>
          </SrCard>
        )}
      </section>
    </div>
  );
}
