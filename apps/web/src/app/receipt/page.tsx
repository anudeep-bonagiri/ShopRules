"use client";

import { DataTable } from "@shopify/polaris";
import { timeAgo, useApi } from "@/lib/client";
import type { RunRow } from "@/lib/db";
import { FAMILIES, receiptLines, type TavilyReceipt } from "@/lib/tavily-receipt";
import { EmptyCard, MetricCard, PageError, Skeleton, SrCard, StatusPill } from "@/components/stitch";

type Receipt = {
  runs: RunRow[];
  totals: { tavily_calls: number; tavily_credits: number; llm_cost_usd: number; all_ultra_cost_usd: number; saved_usd: number; saved_pct: number; calls: number; prompt_tokens: number; completion_tokens: number };
  by_tier: Record<string, { calls: number; prompt_tokens: number; completion_tokens: number; cost_usd: number; ms: number }>;
  models: Record<string, string>;
  prices_per_million: Record<string, { in: number; out: number }>;
  tavily?: TavilyReceipt;
};

const TIERS = ["nano", "super", "ultra"] as const;
const TIER_NAME: Record<string, string> = { nano: "Nemotron 3 Nano", super: "Nemotron 3 Super", ultra: "Nemotron 3 Ultra" };

export default function ReceiptPage() {
  const receipt = useApi<Receipt>("/api/receipt");
  const { data, loading } = receipt;
  const t = data?.totals;
  const maxCost = Math.max(...TIERS.map((k) => data?.by_tier[k]?.cost_usd ?? 0), 0.000001);

  if (receipt.error) return <PageError title="Cost receipt" subtitle="Which model did what, what it cost, and what sending every call to the largest model would have cost." error={receipt.error ?? ""} status={receipt.status} onRetry={receipt.refresh} />;

  return (
    <div className="sr-page">
      <div className="sr-topline">
        <div className="sr-grow">
          <h1 className="sr-h1">Cost receipt</h1>
          <p className="sr-sm" style={{ marginTop: 4 }}>
            Which model did what, what it cost, and what sending every call to the largest model would have cost.
          </p>
        </div>
        {t ? (
          <StatusPill tone="success" caps={false}>
            {t.calls} model call{t.calls === 1 ? "" : "s"}
          </StatusPill>
        ) : null}
      </div>

      <div className="sr-metrics sr-metrics--4">
        <MetricCard label="Model spend" value={t ? `$${t.llm_cost_usd.toFixed(4)}` : "..."} delta={t ? `${t.calls} calls` : undefined} />
        <MetricCard label="All-Ultra baseline" value={t ? `$${t.all_ultra_cost_usd.toFixed(4)}` : "..."} delta="same tokens, every call on Ultra" />
        <MetricCard label="Saved by routing" value={t ? `${t.saved_pct.toFixed(0)}%` : "..."} tone={t && t.saved_usd > 0 ? "success" : "neutral"} delta={t ? `$${t.saved_usd.toFixed(4)}` : undefined} />
        <MetricCard label="Source reads" value={t ? String(t.tavily_calls) : "..."} delta={t ? `${t.tavily_credits} credits (est.)` : undefined} />
      </div>

      <SrCard className="sr-stack">
        <div className="sr-row sr-row--between">
          <h2 className="sr-h2">Tavily, the source layer</h2>
          {data?.tavily ? (
            <StatusPill tone="success" caps={false}>
              {Math.round(data.tavily.runs_without_model_ratio * 100)}% of runs needed no model
            </StatusPill>
          ) : null}
        </div>
        <p className="sr-xs">Search finds the official pages (restricted to each rule&apos;s domains), Extract reads them for the verifier and the daily price refresh, Map and Crawl walk the state revenue sites for nexus thresholds. The model only sees what Tavily read.</p>
        {data?.tavily ? (
          <>
            <div className="sr-stack sr-stack--tight">
              {receiptLines(data.tavily).map((line, i) => (
                <p key={i} className="sr-sm sr-num">
                  {line}
                </p>
              ))}
            </div>
            <DataTable
              columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "numeric", "numeric", "numeric"]}
              headings={["Family", "Search", "Extract", "Map", "Crawl", "Credits", "Alerts", "No model"]}
              rows={FAMILIES.map((f) => {
                const r = data.tavily!.by_family[f];
                return [f, r.search, r.extract, r.map, r.crawl, r.credits, r.alerts, r.tavily_only_alerts];
              })}
            />
          </>
        ) : (
          <Skeleton lines={2} card={false} />
        )}
      </SrCard>

      <SrCard className="sr-stack">
        <h2 className="sr-h2">By model</h2>
        {TIERS.map((k) => {
          const row = data?.by_tier[k];
          const cost = row?.cost_usd ?? 0;
          return (
            <div key={k} className="sr-stack sr-stack--tight">
              <div className="sr-row sr-row--between sr-row--wrap" style={{ gap: 4 }}>
                <div className="sr-grow">
                  <span className="sr-body" style={{ fontWeight: 600 }}>
                    {TIER_NAME[k]}
                  </span>{" "}
                  <span className="sr-xs sr-mono">{data?.models[k]}</span>
                </div>
                <span className="sr-xs sr-num">{row ? `${row.calls} calls, ${(row.prompt_tokens + row.completion_tokens).toLocaleString()} tokens, $${cost.toFixed(4)}, ${(row.ms / Math.max(row.calls, 1) / 1000).toFixed(1)} s avg` : "no calls"}</span>
              </div>
              <div className="sr-progress">
                <span style={{ width: `${(cost / maxCost) * 100}%`, background: k === "ultra" ? "var(--sr-text)" : k === "super" ? "var(--sr-text-2)" : "var(--sr-primary)" }} />
              </div>
            </div>
          );
        })}
        <p className="sr-xs sr-num">
          Nano does extraction, classification, competitor parsing, and standing instructions. Ultra only does the one hard step: deciding whether a rule touches the product and drafting the action. Prices per million tokens (in/out):{" "}
          {TIERS.map((k) => `${k} $${data?.prices_per_million[k]?.in ?? "?"}/$${data?.prices_per_million[k]?.out ?? "?"}`).join(", ")}. Set NEMOTRON_PRICE_* to match your invoice.
        </p>
      </SrCard>

      {loading ? (
        <Skeleton lines={4} />
      ) : !data || data.runs.length === 0 ? (
        <EmptyCard title="No runs yet" text="Every check, classification, and dismissal writes a line here with its source reads, model calls, and cost." />
      ) : (
        <SrCard flush>
          <DataTable
            columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "numeric"]}
            headings={["When", "Run", "Source reads", "Model calls", "Cost", "Duration"]}
            rows={data.runs.map((r) => [timeAgo(r.created_at), r.kind, r.tavily_calls, r.llm.length, `$${r.llm_cost_usd.toFixed(4)}`, `${(r.duration_ms / 1000).toFixed(1)} s`])}
          />
        </SrCard>
      )}
    </div>
  );
}
