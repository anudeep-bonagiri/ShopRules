"use client";

import { Badge, Banner, BlockStack, Box, Button, Card, Divider, InlineStack, Layout, Link, List, Page, Text } from "@shopify/polaris";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api, money, timeAgo, useApi } from "@/lib/client";
import { EvidenceBar, FamilyBadge, KeyValue, MarketplaceBadge, SeverityBadge, Sparkline, StatusBadge } from "@/components/ui";
import type { AlertRow, PriceRow, ProductRow, RuleRow, SkillRow } from "@/lib/db";
import { countryName, FAMILY_LABEL } from "@/lib/rules-catalog";

type Detail = { product: ProductRow; rules: RuleRow[]; alerts: AlertRow[]; price_history: PriceRow[]; skills: SkillRow[] };
type CheckResult = { alerts: AlertRow[]; checked: number; skipped_unchanged: number; errors: string[]; meter: { tavily_calls: number; llm: Array<{ tier: string; cost_usd: number }> } };

export default function ProductPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data, loading, error, refresh } = useApi<Detail>(params?.id ? `/api/products/${params.id}` : null);
  const [checking, setChecking] = useState<"due" | "all" | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runCheck(force: boolean) {
    setChecking(force ? "all" : "due");
    setActionError(null);
    try {
      const r = await api<CheckResult>(`/api/products/${params.id}/check`, { method: "POST", json: { force, max_rules: force ? 6 : 4 } });
      setResult(r);
      refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setChecking(null);
    }
  }

  async function remove() {
    if (!confirm("Stop watching this product? Its rules and alerts are removed too.")) return;
    try {
      await api(`/api/products/${params.id}`, { method: "DELETE" });
      router.push("/products");
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  if (error) {
    return (
      <Page title="Product" backAction={{ url: "/products" }}>
        <Banner tone="critical">
          <p>{error}</p>
        </Banner>
      </Page>
    );
  }
  if (loading || !data) {
    return (
      <Page title="Loading product" backAction={{ url: "/products" }}>
        <Card>
          <Text as="p" tone="subdued">
            Loading...
          </Text>
        </Card>
      </Page>
    );
  }

  const { product, rules, alerts, price_history, skills } = data;
  const profile = product.profile;
  const openAlerts = alerts.filter((a) => a.status === "new");
  const dueCount = rules.filter((r) => !r.last_run_at || Date.now() - new Date(r.last_run_at).getTime() > r.cadence_hours * 3600 * 1000).length;
  const flags = [
    profile.intended_for_children ? "For children" : null,
    profile.is_cosmetic ? "Cosmetic" : null,
    profile.is_electronic ? "Electronic" : null,
    profile.has_battery ? "Battery" : null,
    profile.is_textile ? "Textile" : null,
    profile.is_food_contact ? "Food contact" : null,
    profile.is_supplement_or_food ? "Food or supplement" : null,
  ].filter(Boolean) as string[];
  const families = Array.from(new Set(rules.map((r) => r.family)));
  const llmCost = result ? result.meter.llm.reduce((s, c) => s + c.cost_usd, 0) : 0;

  return (
    <Page
      title={product.title}
      subtitle={`${money(product.price, product.currency)} on ${product.marketplace}`}
      backAction={{ url: "/products" }}
      primaryAction={{ content: dueCount ? `Run check now (${dueCount} due)` : "Run check now", onAction: () => runCheck(false), loading: checking === "due", disabled: checking !== null }}
      secondaryActions={[
        { content: "Re-run every rule", onAction: () => runCheck(true), loading: checking === "all", disabled: checking !== null },
        { content: "Open listing", url: product.url, external: true },
        { content: "Stop watching", destructive: true, onAction: remove },
      ]}
    >
      <Layout>
        {actionError ? (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setActionError(null)}>
              <p>{actionError}</p>
            </Banner>
          </Layout.Section>
        ) : null}
        {checking ? (
          <Layout.Section>
            <Banner tone="info" title="Checking official sources">
              <p>Tavily is searching and extracting the official pages for each rule, then Nemotron 3 Ultra decides whether the change touches this product. This takes 20 to 60 seconds.</p>
            </Banner>
          </Layout.Section>
        ) : null}
        {result ? (
          <Layout.Section>
            <Banner tone={result.alerts.length ? "warning" : "success"} title={result.alerts.length ? `${result.alerts.length} new alert${result.alerts.length === 1 ? "" : "s"}` : "No new alerts"} onDismiss={() => setResult(null)}>
              <p>
                Checked {result.checked} rule{result.checked === 1 ? "" : "s"}, {result.skipped_unchanged} unchanged since last run, {result.meter.tavily_calls} Tavily calls, {result.meter.llm.length} Nemotron calls (about ${llmCost.toFixed(4)}).
                {result.errors.length ? ` Problems: ${result.errors.join("; ")}` : ""}
              </p>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Alerts for this product
                </Text>
                <Badge tone={openAlerts.length ? "attention" : undefined}>{`${openAlerts.length} open`}</Badge>
              </InlineStack>
              {alerts.length === 0 ? (
                <Text as="p" tone="subdued">
                  Nothing yet. Run a check to search the official sources for each rule.
                </Text>
              ) : (
                <BlockStack gap="300">
                  {alerts.map((a) => (
                    <Box key={a.id} paddingBlockStart="200" borderBlockStartWidth="025" borderColor="border">
                      <BlockStack gap="150">
                        <InlineStack gap="200" blockAlign="center">
                          <StatusBadge status={a.status} />
                          <SeverityBadge severity={a.severity} />
                          <FamilyBadge family={a.family} />
                          <Text as="span" variant="bodySm" tone="subdued">
                            {timeAgo(a.created_at)}
                          </Text>
                        </InlineStack>
                        <Link url={`/alerts/${a.id}`} removeUnderline>
                          <Text as="span" variant="headingSm">
                            {a.headline}
                          </Text>
                        </Link>
                        <EvidenceBar proposed={a.proposed} backed={a.backed} rejected={a.rejected} compact />
                        <Text as="span" variant="bodySm">
                          Next step: {a.action?.title}
                        </Text>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Watch rules
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Each rule searches only the official domains listed, on its own cadence. Seed values are starting points; every alert quotes the live page.
              </Text>
              {families.map((f) => (
                <BlockStack key={f} gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <FamilyBadge family={f} />
                    <Text as="span" variant="bodySm" tone="subdued">
                      {FAMILY_LABEL[f]}
                    </Text>
                  </InlineStack>
                  {rules
                    .filter((r) => r.family === f)
                    .map((r) => (
                      <Box key={r.id} padding="300" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="start" gap="200">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {r.title}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              every {r.cadence_hours} h, last run {timeAgo(r.last_run_at)}
                            </Text>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            Sources: {r.include_domains.join(", ")}
                          </Text>
                          {r.seed_note ? (
                            <Text as="span" variant="bodySm">
                              {r.seed_note}
                            </Text>
                          ) : null}
                          {r.last_headline ? (
                            <Text as="span" variant="bodySm">
                              Last finding: {r.last_headline}
                            </Text>
                          ) : null}
                        </BlockStack>
                      </Box>
                    ))}
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Price history
              </Text>
              <Sparkline points={price_history.map((p) => ({ at: p.at, price: Number(p.price) }))} markers={alerts.map((a) => a.created_at)} />
              <Text as="p" variant="bodySm" tone="subdued">
                Red lines mark alerts. Points come from the listing when you add it, from the extension when you open the page, and from checks.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Product profile
              </Text>
              {product.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.image_url} alt="" style={{ width: "100%", borderRadius: 8, objectFit: "cover", maxHeight: 220 }} />
              ) : null}
              <KeyValue
                rows={[
                  ["Marketplace", <MarketplaceBadge key="m" marketplace={product.marketplace} />],
                  ["Category", profile.category],
                  ["Type", profile.product_type],
                  ["Origin", profile.origin_country ? `${countryName(profile.origin_country)} (${profile.origin_country})` : "Not stated on the listing"],
                  ["Materials", profile.materials.join(", ") || "n/a"],
                ]}
              />
              {flags.length ? (
                <InlineStack gap="100" wrap>
                  {flags.map((f) => (
                    <Badge key={f}>{f}</Badge>
                  ))}
                </InlineStack>
              ) : null}
              <Divider />
              <Text as="h3" variant="headingSm">
                HTS candidates
              </Text>
              {profile.hts_candidates.length ? (
                <List>
                  {profile.hts_candidates.map((h) => (
                    <List.Item key={h.code}>
                      <Text as="span" variant="bodySm">
                        <span className="sr-mono">{h.code}</span> {h.description} ({Math.round(h.confidence * 100)}%)
                      </Text>
                    </List.Item>
                  ))}
                </List>
              ) : (
                <Text as="p" tone="subdued" variant="bodySm">
                  None proposed.
                </Text>
              )}
              <Text as="p" variant="bodySm" tone="subdued">
                {profile.summary}
              </Text>
            </BlockStack>
          </Card>
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Standing instructions
                </Text>
                {skills.length === 0 ? (
                  <Text as="p" tone="subdued" variant="bodySm">
                    When you dismiss an alert with a reason, Shop Rules writes it down here and follows it on future checks.
                  </Text>
                ) : (
                  <List>
                    {skills.map((s) => (
                      <List.Item key={s.id}>
                        <Text as="span" variant="bodySm">
                          {s.text} <Badge>{s.scope}</Badge>
                        </Text>
                      </List.Item>
                    ))}
                  </List>
                )}
              </BlockStack>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
