"use client";

import { BlockStack, Card, DataTable, InlineGrid, InlineStack, Layout, Page, Text } from "@shopify/polaris";
import { timeAgo, useApi } from "@/lib/client";
import { Stat } from "@/components/ui";
import type { RunRow } from "@/lib/db";

type Receipt = {
  runs: RunRow[];
  totals: { tavily_calls: number; tavily_credits: number; llm_cost_usd: number; all_ultra_cost_usd: number; saved_usd: number; saved_pct: number; calls: number; prompt_tokens: number; completion_tokens: number };
  by_tier: Record<string, { calls: number; prompt_tokens: number; completion_tokens: number; cost_usd: number; ms: number }>;
  models: Record<string, string>;
  prices_per_million: Record<string, { in: number; out: number }>;
};

export default function ReceiptPage() {
  const { data, loading } = useApi<Receipt>("/api/receipt");
  const t = data?.totals;
  const tiers = ["nano", "super", "ultra"];
  const maxCost = Math.max(...tiers.map((k) => data?.by_tier[k]?.cost_usd ?? 0), 0.000001);

  return (
    <Page title="Cost receipt" subtitle="Which Nemotron model did what, what it cost, and what sending everything to Ultra would have cost.">
      <Layout>
        <Layout.Section>
          <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
            <Card>
              <Stat label="Nemotron spend" value={t ? `$${t.llm_cost_usd.toFixed(4)}` : "..."} hint={t ? `${t.calls} calls` : undefined} />
            </Card>
            <Card>
              <Stat label="All-Ultra baseline" value={t ? `$${t.all_ultra_cost_usd.toFixed(4)}` : "..."} hint="Same tokens, every call on Ultra" />
            </Card>
            <Card>
              <Stat label="Saved by routing" value={t ? `${t.saved_pct.toFixed(0)}%` : "..."} hint={t ? `$${t.saved_usd.toFixed(4)}` : undefined} />
            </Card>
            <Card>
              <Stat label="Tavily" value={t ? String(t.tavily_calls) : "..."} hint={t ? `${t.tavily_credits} credits (est.)` : undefined} />
            </Card>
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                By model
              </Text>
              {tiers.map((k) => {
                const row = data?.by_tier[k];
                const cost = row?.cost_usd ?? 0;
                return (
                  <BlockStack key={k} gap="100">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {k === "nano" ? "Nemotron 3 Nano" : k === "super" ? "Nemotron 3 Super" : "Nemotron 3 Ultra"}
                        <Text as="span" variant="bodySm" tone="subdued">
                          {" "}
                          {data?.models[k]}
                        </Text>
                      </Text>
                      <Text as="span" variant="bodySm">
                        {row ? `${row.calls} calls, ${(row.prompt_tokens + row.completion_tokens).toLocaleString()} tokens, $${cost.toFixed(4)}, ${(row.ms / Math.max(row.calls, 1) / 1000).toFixed(1)} s avg` : "no calls"}
                      </Text>
                    </InlineStack>
                    <div className="sr-evidence-bar">
                      <span style={{ width: `${(cost / maxCost) * 100}%`, background: k === "ultra" ? "#303030" : k === "super" ? "#616161" : "#008060" }} />
                    </div>
                  </BlockStack>
                );
              })}
              <Text as="p" variant="bodySm" tone="subdued">
                Nano does extraction, classification, competitor parsing, and skills. Ultra only does the one hard step: deciding whether a rule touches the product and drafting the action. Prices per million tokens (in/out): {tiers.map((k) => `${k} $${data?.prices_per_million[k]?.in ?? "?"}/$${data?.prices_per_million[k]?.out ?? "?"}`).join(", ")}. Set NEMOTRON_PRICE_* to match your Token Factory invoice.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            {loading ? (
              <div style={{ padding: 16 }}>
                <Text as="p" tone="subdued">
                  Loading...
                </Text>
              </div>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "numeric"]}
                headings={["When", "Run", "Tavily calls", "Nemotron calls", "Cost", "Duration"]}
                rows={(data?.runs ?? []).map((r) => [timeAgo(r.created_at), r.kind, r.tavily_calls, r.llm.length, `$${r.llm_cost_usd.toFixed(4)}`, `${(r.duration_ms / 1000).toFixed(1)} s`])}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
