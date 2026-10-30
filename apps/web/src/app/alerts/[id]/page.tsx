"use client";

import { Badge, Banner, BlockStack, Box, Button, Card, Divider, InlineStack, Layout, Link, List, Modal, Page, Text, TextField } from "@shopify/polaris";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, money, timeAgo, useApi } from "@/lib/client";
import { EvidenceBar, FamilyBadge, KeyValue, SeverityBadge, StatusBadge } from "@/components/ui";
import type { AlertRow, ProductRow, RuleRow, SkillRow } from "@/lib/db";

type Detail = { alert: AlertRow; product: ProductRow | null; rule: RuleRow | null; sources: AlertRow["sources"] };

const ACTION_LABEL: Record<string, string> = {
  reprice: "Reprice",
  compliance_step: "Compliance step",
  register_tax: "Tax registration",
  review: "Needs review",
  none: "No action",
};

export default function AlertPage() {
  const params = useParams<{ id: string }>();
  const { data, loading, error, refresh } = useApi<Detail>(params?.id ? `/api/alerts/${params.id}` : null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function setStatus(status: "actioned" | "dismissed" | "new") {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api<{ alert: AlertRow; skill: SkillRow | null }>(`/api/alerts/${params.id}`, { method: "PATCH", json: { status, reason } });
      setDismissOpen(false);
      setReason("");
      setNotice(
        status === "dismissed"
          ? r.skill
            ? `Dismissed. Learned a standing instruction: "${r.skill.text}"`
            : "Dismissed."
          : status === "actioned"
            ? "Marked done."
            : "Reopened.",
      );
      refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Page title="Alert" backAction={{ url: "/alerts" }}>
        <Banner tone="critical">
          <p>{error}</p>
        </Banner>
      </Page>
    );
  }
  if (loading || !data) {
    return (
      <Page title="Loading alert" backAction={{ url: "/alerts" }}>
        <Card>
          <Text as="p" tone="subdued">
            Loading...
          </Text>
        </Card>
      </Page>
    );
  }

  const { alert, product, rule } = data;
  const act = alert.action;
  const priceNow = product?.price ?? null;

  return (
    <Page
      title={alert.headline}
      titleMetadata={
        <InlineStack gap="100">
          <StatusBadge status={alert.status} />
          <SeverityBadge severity={alert.severity} />
          <FamilyBadge family={alert.family} />
        </InlineStack>
      }
      subtitle={`${product?.title ?? "Product"} | ${rule?.title ?? ""} | ${timeAgo(alert.created_at)}`}
      backAction={{ url: "/alerts" }}
      primaryAction={alert.status === "new" ? { content: "Mark done", onAction: () => setStatus("actioned"), loading: busy } : { content: "Reopen", onAction: () => setStatus("new"), loading: busy }}
      secondaryActions={alert.status === "new" ? [{ content: "Dismiss", onAction: () => setDismissOpen(true) }] : []}
    >
      <Layout>
        {notice ? (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setNotice(null)}>
              <p>{notice}</p>
            </Banner>
          </Layout.Section>
        ) : null}
        {actionError ? (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setActionError(null)}>
              <p>{actionError}</p>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  What to do
                </Text>
                <Badge tone={act.type === "none" ? undefined : "attention"}>{ACTION_LABEL[act.type] ?? act.type}</Badge>
              </InlineStack>
              <Text as="p" variant="headingSm">
                {act.title}
              </Text>
              {act.type === "reprice" && act.suggested_price != null ? (
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <InlineStack gap="600">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Current price
                      </Text>
                      <Text as="span" variant="headingMd">
                        {money(priceNow, product?.currency)}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Suggested price
                      </Text>
                      <Text as="span" variant="headingMd">
                        {money(act.suggested_price, product?.currency)}
                      </Text>
                    </BlockStack>
                    {alert.impact.tariff_rate_change_pct != null ? (
                      <BlockStack gap="050">
                        <Text as="span" variant="bodySm" tone="subdued">
                          Duty change
                        </Text>
                        <Text as="span" variant="headingMd">
                          {alert.impact.tariff_rate_change_pct > 0 ? "+" : ""}
                          {alert.impact.tariff_rate_change_pct} pts
                        </Text>
                      </BlockStack>
                    ) : null}
                  </InlineStack>
                </Box>
              ) : null}
              {act.steps?.length ? (
                <List type="number">
                  {act.steps.map((s, i) => (
                    <List.Item key={i}>{s}</List.Item>
                  ))}
                </List>
              ) : null}
              <Text as="p" variant="bodySm" tone="subdued">
                {act.rationale}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Evidence check
              </Text>
              <EvidenceBar proposed={alert.proposed} backed={alert.backed} rejected={alert.rejected} />
              <Text as="p" variant="bodySm" tone="subdued">
                Nemotron 3 Ultra proposed each claim with a quote. The verifier kept a claim only when that quote appears in the text Tavily extracted from the source. Rejected claims stay visible so you can see what was dropped.
              </Text>
              <Divider />
              <BlockStack gap="300">
                {alert.claims.map((c, i) => (
                  <BlockStack key={i} gap="150">
                    <InlineStack gap="200" blockAlign="center">
                      {c.backed ? <Badge tone="success">Backed</Badge> : <Badge tone="critical">Rejected</Badge>}
                      <Text as="span" variant="bodySm" tone="subdued">
                        {hostOf(c.matched_url ?? c.source_url)}
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {c.claim}
                    </Text>
                    <div className="sr-quote">{c.quote}</div>
                    <Link url={c.matched_url ?? c.source_url} external>
                      Open source
                    </Link>
                  </BlockStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Impact
              </Text>
              <KeyValue
                rows={[
                  ["Relevance", alert.relevance === "affects" ? "Applies to this product" : "Might apply"],
                  ["Severity", <SeverityBadge key="s" severity={alert.severity} />],
                  ["Effective date", alert.impact.effective_date ?? "Not stated"],
                  ["Duty change", alert.impact.tariff_rate_change_pct != null ? `${alert.impact.tariff_rate_change_pct} pts` : "n/a"],
                  ["Est. cost change", alert.impact.estimated_cost_change_pct != null ? `${alert.impact.estimated_cost_change_pct}%` : "n/a"],
                ]}
              />
            </BlockStack>
          </Card>
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Sources read
                </Text>
                <List>
                  {alert.sources.map((s) => (
                    <List.Item key={s.url}>
                      <BlockStack gap="050">
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {s.domain}
                        </Text>
                        <Link url={s.url} external>
                          {s.title || s.url}
                        </Link>
                      </BlockStack>
                    </List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>
          </Box>
          {product ? (
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Product
                  </Text>
                  <Link url={`/products/${product.id}`}>{product.title}</Link>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {money(product.price, product.currency)} on {product.marketplace}
                  </Text>
                </BlockStack>
              </Card>
            </Box>
          ) : null}
        </Layout.Section>
      </Layout>

      <Modal
        open={dismissOpen}
        onClose={() => setDismissOpen(false)}
        title="Dismiss this alert"
        primaryAction={{ content: "Dismiss", onAction: () => setStatus("dismissed"), loading: busy }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDismissOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">Tell Shop Rules why. It turns your reason into a standing instruction so the same alert does not come back.</Text>
            <TextField label="Reason" value={reason} onChange={setReason} multiline={3} autoComplete="off" placeholder="We already hold a CPC for this item, tested in March." />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
