"use client";

import { BlockStack, Card, DataTable, InlineGrid, Layout, Link, Page, Text } from "@shopify/polaris";
import { timeAgo, useApi } from "@/lib/client";
import { FamilyBadge } from "@/components/ui";
import type { RuleRow } from "@/lib/db";

type Rule = RuleRow & { product_title: string };

export default function RulesPage() {
  const { data, loading } = useApi<{ rules: Rule[] }>("/api/rules");
  const rules = data?.rules ?? [];

  const rows = rules.map((r) => [
    <FamilyBadge key="f" family={r.family} />,
    <BlockStack key="t" gap="050">
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {r.title}
      </Text>
      <Link url={`/products/${r.product_id}`} removeUnderline>
        <Text as="span" variant="bodySm" tone="subdued">
          {r.product_title}
        </Text>
      </Link>
    </BlockStack>,
    <Text key="d" as="span" variant="bodySm">
      {r.include_domains.join(", ")}
    </Text>,
    `${r.cadence_hours} h`,
    timeAgo(r.last_run_at),
    r.last_headline ?? "",
  ]);

  return (
    <Page title="Watch rules" subtitle="What Shop Rules checks, where, and how often.">
      <Layout>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 4 }} gap="400">
            <Card>
              <BlockStack gap="100">
                <FamilyBadge family="tariff" />
                <Text as="p" variant="bodySm">
                  CBP, USTR, Federal Register, trade.gov, the HTS. Origin, Section 301, de minimis, and the HTS heading the classifier proposed.
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <FamilyBadge family="safety" />
                <Text as="p" variant="bodySm">
                  CPSC, FDA, FTC, FCC, and OEHHA for Prop 65. Seeded from what the product is: items for children, cosmetics, batteries, textiles, food contact.
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <FamilyBadge family="tax" />
                <Text as="p" variant="bodySm">
                  The revenue site of each state you ship to. Economic nexus thresholds and marketplace facilitator rules.
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <FamilyBadge family="policy" />
                <Text as="p" variant="bodySm">
                  Seller Central, Etsy Help, and Shopify Help for category policy changes.
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            {loading ? (
              <div style={{ padding: 16 }}>
                <Text as="p" tone="subdued">
                  Loading...
                </Text>
              </div>
            ) : rules.length === 0 ? (
              <div style={{ padding: 16 }}>
                <Text as="p" tone="subdued">
                  No rules yet. Watch a product and its rules appear here.
                </Text>
              </div>
            ) : (
              <DataTable columnContentTypes={["text", "text", "text", "text", "text", "text"]} headings={["Family", "Rule", "Official domains", "Cadence", "Last run", "Last finding"]} rows={rows} />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
