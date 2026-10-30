"use client";

import { Badge, Banner, BlockStack, Button, Card, EmptyState, IndexTable, InlineStack, Layout, Page, Text, TextField } from "@shopify/polaris";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, money, timeAgo, useApi } from "@/lib/client";
import { MarketplaceBadge } from "@/components/ui";
import type { ProductRow } from "@/lib/db";

export default function ProductsPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data, loading, refresh } = useApi<{ products: ProductRow[] }>("/api/products");
  const products = data?.products ?? [];

  async function add() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ product: ProductRow }>("/api/products", { method: "POST", json: { url } });
      setUrl("");
      refresh();
      router.push(`/products/${r.product.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Products" subtitle="Everything you watch, with the rules seeded for each one.">
      <Layout>
        {error ? (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        ) : null}
        <Layout.Section>
          <Card>
            <InlineStack gap="200" blockAlign="end" wrap={false}>
              <div style={{ flex: 1 }}>
                <TextField label="Listing URL" value={url} onChange={setUrl} autoComplete="off" placeholder="https://www.amazon.com/dp/..." />
              </div>
              <Button variant="primary" onClick={add} loading={busy} disabled={!url.trim()}>
                Watch product
              </Button>
            </InlineStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card padding="0">
            {!loading && products.length === 0 ? (
              <EmptyState heading="No products yet" action={{ content: "Load demo shop", url: "/" }} image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                <p>Paste a listing URL above, or add one from the Chrome extension while you are on the page.</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "product", plural: "products" }}
                itemCount={products.length}
                selectable={false}
                loading={loading}
                headings={[{ title: "Product" }, { title: "Price" }, { title: "Open alerts" }, { title: "Origin" }, { title: "Last checked" }]}
              >
                {products.map((p, index) => (
                  <IndexTable.Row id={p.id} key={p.id} position={index} onClick={() => router.push(`/products/${p.id}`)}>
                    <IndexTable.Cell>
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {p.title}
                        </Text>
                        <InlineStack gap="100">
                          <MarketplaceBadge marketplace={p.marketplace} />
                          <Text as="span" variant="bodySm" tone="subdued">
                            {p.profile?.product_type}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{money(p.price, p.currency)}</IndexTable.Cell>
                    <IndexTable.Cell>{p.open_alerts ? <Badge tone="attention">{String(p.open_alerts)}</Badge> : <Badge>0</Badge>}</IndexTable.Cell>
                    <IndexTable.Cell>{p.profile?.origin_country ?? "unknown"}</IndexTable.Cell>
                    <IndexTable.Cell>{timeAgo(p.last_checked_at)}</IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
