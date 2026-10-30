"use client";

import { BlockStack, Box, Card, EmptyState, InlineStack, Layout, Link, Page, Tabs, Text } from "@shopify/polaris";
import { useState } from "react";
import { timeAgo, useApi } from "@/lib/client";
import { EvidenceBar, FamilyBadge, SeverityBadge, StatusBadge } from "@/components/ui";
import type { AlertRow } from "@/lib/db";

const TABS = [
  { id: "new", content: "Open" },
  { id: "actioned", content: "Done" },
  { id: "dismissed", content: "Dismissed" },
  { id: "all", content: "All" },
];

export default function AlertsPage() {
  const [tab, setTab] = useState(0);
  const status = TABS[tab].id;
  const { data, loading } = useApi<{ alerts: AlertRow[] }>(`/api/alerts?status=${status}`);
  const alerts = data?.alerts ?? [];

  return (
    <Page title="Alerts" subtitle="Every alert quotes the official source. The verifier shows what it kept and what it dropped.">
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={TABS} selected={tab} onSelect={setTab} />
            <Box padding="400">
              {loading ? (
                <Text as="p" tone="subdued">
                  Loading...
                </Text>
              ) : alerts.length === 0 ? (
                <EmptyState heading="No alerts here" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>Run a check from a product page to search the official sources.</p>
                </EmptyState>
              ) : (
                <BlockStack gap="400">
                  {alerts.map((a) => (
                    <Box key={a.id} paddingBlockEnd="400" borderBlockEndWidth="025" borderColor="border">
                      <BlockStack gap="150">
                        <InlineStack gap="200" blockAlign="center">
                          <StatusBadge status={a.status} />
                          <SeverityBadge severity={a.severity} />
                          <FamilyBadge family={a.family} />
                          <Text as="span" variant="bodySm" tone="subdued">
                            {a.relevance === "affects" ? "Applies to this product" : "Might apply"}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {timeAgo(a.created_at)}
                          </Text>
                        </InlineStack>
                        <Link url={`/alerts/${a.id}`} removeUnderline>
                          <Text as="span" variant="headingSm">
                            {a.headline}
                          </Text>
                        </Link>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {a.product_title} | {a.rule_title}
                        </Text>
                        <EvidenceBar proposed={a.proposed} backed={a.backed} rejected={a.rejected} />
                        <Text as="span" variant="bodySm">
                          Next step: {a.action?.title}
                        </Text>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
