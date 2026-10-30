"use client";

import { Badge, Banner, BlockStack, Button, Card, Checkbox, Divider, InlineGrid, InlineStack, Layout, List, Page, Text, TextField } from "@shopify/polaris";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/client";
import type { AccountRow } from "@/lib/db";
import { STATES } from "@/lib/rules-catalog";

type Health = { ok: boolean; tavily_mode: string; nemotron_configured: boolean; storage_configured: boolean; models: Record<string, string> };

export default function SettingsPage() {
  const { data, refresh } = useApi<{ account: AccountRow & { telegram_configured: boolean } }>("/api/account");
  const health = useApi<Health>("/api/health");
  const [states, setStates] = useState<string[]>([]);
  const [margin, setMargin] = useState("35");
  const [unitCost, setUnitCost] = useState("45");
  const [telegram, setTelegram] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!data) return;
    setStates(data.account.settings.ship_to_states ?? []);
    setMargin(String(data.account.settings.target_margin_pct ?? 35));
    setUnitCost(String(data.account.settings.unit_cost_pct ?? 45));
    setTelegram(data.account.telegram_chat_id ?? "");
  }, [data]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api("/api/account", {
        method: "PATCH",
        json: { settings: { ship_to_states: states, target_margin_pct: Number(margin), unit_cost_pct: Number(unitCost) }, telegram_chat_id: telegram || null },
      });
      setNotice("Saved. New products use these ship-to states; existing products keep their rules.");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function copyToken() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.account.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy. Select the token and copy it by hand.");
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <Page title="Settings" subtitle="Your workspace, ship-to states, pricing assumptions, and the extension token.">
      <Layout>
        {notice ? (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setNotice(null)}>
              <p>{notice}</p>
            </Banner>
          </Layout.Section>
        ) : null}
        {error ? (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Chrome extension
              </Text>
              <Text as="p" tone="subdued">
                Install the extension from the repository (extension/dist), open its popup, and paste this URL and token. Then hover any listing on Etsy, Shopify, or Amazon and press Alt+Shift+S.
              </Text>
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                <TextField label="Shop Rules URL" value={origin} readOnly autoComplete="off" />
                <TextField label="Account token" value={data?.account.token ?? ""} readOnly autoComplete="off" connectedRight={<Button onClick={copyToken}>{copied ? "Copied" : "Copy"}</Button>} />
              </InlineGrid>
              <Text as="p" variant="bodySm" tone="subdued">
                The token identifies this workspace. Anyone with it can read your watch list, so treat it like a password.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Ship-to states
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Each state adds a sales-tax rule that watches the revenue site of that state for its economic nexus threshold. Pick the states where most of your orders go.
              </Text>
              <InlineGrid columns={{ xs: 2, sm: 3, md: 4 }} gap="100">
                {STATES.map((s) => (
                  <Checkbox
                    key={s.code}
                    label={`${s.name} (${s.code})`}
                    checked={states.includes(s.code)}
                    onChange={(v) => setStates((prev) => (v ? Array.from(new Set([...prev, s.code])) : prev.filter((x) => x !== s.code)))}
                  />
                ))}
              </InlineGrid>
              <Divider />
              <Text as="h2" variant="headingMd">
                Pricing assumptions
              </Text>
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                <TextField label="Landed cost as % of listing price" type="number" value={unitCost} onChange={setUnitCost} autoComplete="off" suffix="%" helpText="Used to turn a duty change into a reprice suggestion." />
                <TextField label="Target margin" type="number" value={margin} onChange={setMargin} autoComplete="off" suffix="%" />
              </InlineGrid>
              <Divider />
              <Text as="h2" variant="headingMd">
                Telegram
              </Text>
              <TextField
                label="Chat id"
                value={telegram}
                onChange={setTelegram}
                autoComplete="off"
                placeholder="123456789"
                helpText={data?.account.telegram_configured ? "Alerts are delivered to this chat." : "Set TELEGRAM_BOT_TOKEN on the server, message your bot once, then put your chat id here."}
              />
              <InlineStack align="end">
                <Button variant="primary" onClick={save} loading={saving}>
                  Save
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Status
              </Text>
              <List>
                <List.Item>
                  Web access: <Badge tone="success">{health.data?.tavily_mode === "keyed" ? "Tavily (key)" : "Tavily (keyless)"}</Badge>
                </List.Item>
                <List.Item>
                  Nemotron on Token Factory: {health.data?.nemotron_configured ? <Badge tone="success">Configured</Badge> : <Badge tone="critical">Missing NEBIUS_API_KEY</Badge>}
                </List.Item>
                <List.Item>Storage: {health.data?.storage_configured ? <Badge tone="success">Vercel Blob</Badge> : <Badge tone="critical">Missing BLOB_READ_WRITE_TOKEN</Badge>}</List.Item>
              </List>
              <Divider />
              <Text as="h3" variant="headingSm">
                Models
              </Text>
              <List>
                <List.Item>
                  <span className="sr-mono">{health.data?.models?.nano}</span> fast calls
                </List.Item>
                <List.Item>
                  <span className="sr-mono">{health.data?.models?.ultra}</span> rule decisions
                </List.Item>
              </List>
              <Divider />
              <Text as="h3" variant="headingSm">
                Your data
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Watch list, alerts, price history, and learned instructions live in one private document per workspace. Self-host with your own Vercel Blob or Postgres (schema in apps/web/supabase) to keep everything under your control.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
