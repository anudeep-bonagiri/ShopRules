"use client";

import { Banner, BlockStack, Box, Button, Card, Divider, InlineGrid, InlineStack, Layout, Link, List, Page, Text, TextField } from "@shopify/polaris";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, timeAgo, useApi } from "@/lib/client";
import { EvidenceBar, FamilyBadge, SeverityBadge, Stat } from "@/components/ui";
import type { AlertRow, ProductRow } from "@/lib/db";

type Health = { ok: boolean; tavily_mode: string; nemotron_configured: boolean; storage_configured: boolean };

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"add" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const products = useApi<{ products: ProductRow[] }>("/api/products");
  const alerts = useApi<{ alerts: AlertRow[] }>("/api/alerts?status=new");
  const allAlerts = useApi<{ alerts: AlertRow[] }>("/api/alerts?status=all");
  const health = useApi<Health>("/api/health");

  const openAlerts = alerts.data?.alerts ?? [];
  const backed = (allAlerts.data?.alerts ?? []).reduce((s, a) => s + a.backed, 0);
  const rejected = (allAlerts.data?.alerts ?? []).reduce((s, a) => s + a.rejected, 0);

  async function addListing() {
    if (!url.trim()) return;
    setBusy("add");
    setError(null);
    try {
      const r = await api<{ product: ProductRow; existing: boolean }>("/api/products", { method: "POST", json: { url } });
      router.push(`/products/${r.product.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function loadDemo() {
    setBusy("demo");
    setError(null);
    try {
      const r = await api<{ products: ProductRow[]; alerts: number; errors: string[] }>("/api/demo/seed", { method: "POST" });
      setNotice(`Loaded ${r.products.length} demo listings and found ${r.alerts} alert${r.alerts === 1 ? "" : "s"} on the first one.${r.errors.length ? ` Notes: ${r.errors.join("; ")}` : ""}`);
      products.refresh();
      alerts.refresh();
      allAlerts.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page
      title="Home"
      subtitle="Your products, the rules that touch them, and what to do today."
      secondaryActions={[{ content: "Load demo shop", onAction: loadDemo, loading: busy === "demo" }]}
    >
      <Layout>
        {health.data && (!health.data.nemotron_configured || !health.data.storage_configured) ? (
          <Layout.Section>
            <Banner tone="warning" title="Setup incomplete">
              <p>
                {!health.data.storage_configured ? "Storage is not configured (BLOB_READ_WRITE_TOKEN). " : ""}
                {!health.data.nemotron_configured ? "Nemotron on Nebius Token Factory is not configured (NEBIUS_API_KEY). Checks will fail until it is set." : ""}
              </p>
            </Banner>
          </Layout.Section>
        ) : null}
        {error ? (
          <Layout.Section>
            <Banner tone="critical" title="Something went wrong" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        ) : null}
        {notice ? (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setNotice(null)}>
              <p>{notice}</p>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Watch a listing
              </Text>
              <Text as="p" tone="subdued">
                Paste an Etsy, Shopify, or Amazon listing URL. Tavily reads the page, Nemotron Nano classifies the product, and the watch rules are seeded from what it finds.
              </Text>
              <InlineStack gap="200" blockAlign="end" wrap={false}>
                <div style={{ flex: 1 }}>
                  <TextField label="Listing URL" labelHidden value={url} onChange={setUrl} autoComplete="off" placeholder="https://www.etsy.com/listing/..." onClearButtonClick={() => setUrl("")} clearButton />
                </div>
                <Button variant="primary" onClick={addListing} loading={busy === "add"} disabled={!url.trim()}>
                  Watch product
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Tip: the Chrome extension adds products from the page you are on and sends the fields it scraped, which works even when a marketplace blocks readers.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
            <Card>
              <Stat label="Products watched" value={products.data ? products.data.products.length : "..."} />
            </Card>
            <Card>
              <Stat label="Open alerts" value={alerts.data ? openAlerts.length : "..."} hint={openAlerts.length ? `${openAlerts.filter((a) => a.severity === "high").length} high` : "Nothing waiting"} />
            </Card>
            <Card>
              <Stat label="Claims backed by sources" value={allAlerts.data ? backed : "..."} hint={allAlerts.data ? `${rejected} dropped by the verifier` : undefined} />
            </Card>
            <Card>
              <Stat label="Web access" value={health.data ? (health.data.tavily_mode === "keyed" ? "Tavily" : "Tavily (keyless)") : "..."} hint="Search and Extract on official domains" />
            </Card>
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Open alerts
                </Text>
                <Link url="/alerts">View all</Link>
              </InlineStack>
              {alerts.loading ? (
                <Text as="p" tone="subdued">
                  Loading...
                </Text>
              ) : openAlerts.length === 0 ? (
                <Text as="p" tone="subdued">
                  No open alerts. Add a product or run a check from a product page.
                </Text>
              ) : (
                <BlockStack gap="300">
                  {openAlerts.slice(0, 5).map((a) => (
                    <Box key={a.id} paddingBlockStart="200" borderBlockStartWidth="025" borderColor="border">
                      <BlockStack gap="150">
                        <InlineStack gap="200" blockAlign="center">
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
                        <Text as="span" variant="bodySm" tone="subdued">
                          {a.product_title}
                        </Text>
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

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                How a check works
              </Text>
              <List type="number">
                <List.Item>Tavily Extract reads your listing. Nemotron Nano turns it into a profile: origin, materials, HTS candidates, who it is for.</List.Item>
                <List.Item>Each product gets watch rules on official domains: CBP, USTR, the Federal Register, CPSC, FDA, FTC, OEHHA, and the state revenue sites you ship to.</List.Item>
                <List.Item>On every run Tavily Search finds the pages, Tavily Extract pulls the relevant chunks, and Nemotron 3 Ultra decides whether the change touches your product and drafts the step.</List.Item>
                <List.Item>A verifier outside the model drops any claim whose quote is not in the extracted text. You see what was proposed, backed, and rejected.</List.Item>
              </List>
              <Divider />
              <Text as="p" variant="bodySm" tone="subdued">
                Powered by Tavily and NVIDIA Nemotron 3 on Nebius Token Factory. Your watch list, alerts, and learned instructions stay in your own workspace.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
