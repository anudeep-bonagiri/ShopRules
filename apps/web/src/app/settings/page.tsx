"use client";

import { Banner, Button, Checkbox, TextField } from "@shopify/polaris";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/client";
import type { AccountRow } from "@/lib/db";
import { STATES } from "@/lib/rules-catalog";
import { KV, SrCard, StatusPill } from "@/components/stitch";

type Health = { ok: boolean; tavily_mode: string; nemotron_configured: boolean; storage_configured: boolean; models: Record<string, string> };

export default function SettingsPage() {
  const { data, refresh } = useApi<{ account: AccountRow & { telegram_configured: boolean } }>("/api/account");
  const health = useApi<Health>("/api/health");
  const [states, setStates] = useState<string[]>([]);
  const [margin, setMargin] = useState("35");
  const [unitCost, setUnitCost] = useState("45");
  const [units, setUnits] = useState("20");
  const [stateSales, setStateSales] = useState<Record<string, string>>({});
  const [telegram, setTelegram] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!data) return;
    const s = data.account.settings;
    setStates(s.ship_to_states ?? []);
    setMargin(String(s.target_margin_pct ?? 35));
    setUnitCost(String(s.unit_cost_pct ?? 45));
    setUnits(String(s.units_per_week ?? 20));
    setStateSales(Object.fromEntries(Object.entries(s.state_sales ?? {}).map(([k, v]) => [k, String(v)])));
    setTelegram(data.account.telegram_chat_id ?? "");
  }, [data]);

  async function save() {
    setSaving(true);
    setError(null);
    const sales: Record<string, number> = {};
    for (const code of states) {
      const raw = stateSales[code];
      if (raw === undefined || raw === "") continue;
      const v = Number(raw);
      if (Number.isFinite(v) && v >= 0) sales[code] = v;
    }
    try {
      await api("/api/account", {
        method: "PATCH",
        json: {
          settings: { ship_to_states: states, target_margin_pct: Number(margin), unit_cost_pct: Number(unitCost), units_per_week: Number(units), state_sales: sales },
          telegram_chat_id: telegram || null,
        },
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

  const selected = STATES.filter((s) => states.includes(s.code));

  return (
    <div className="sr-page">
      <div className="sr-topline">
        <div className="sr-grow">
          <h1 className="sr-h1">Settings</h1>
          <p className="sr-sm" style={{ marginTop: 4 }}>
            Pricing assumptions, the states you ship to, and the extension token.
          </p>
        </div>
        {health.data ? (
          <StatusPill tone={health.data.nemotron_configured && health.data.storage_configured ? "success" : "warning"} caps={false} live={health.data.nemotron_configured && health.data.storage_configured}>
            {health.data.nemotron_configured && health.data.storage_configured ? "Workspace ready" : "Setup incomplete"}
          </StatusPill>
        ) : null}
      </div>

      {notice ? (
        <Banner tone="success" onDismiss={() => setNotice(null)}>
          <p>{notice}</p>
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      ) : null}

      <div className="sr-hud">
        <div className="sr-hud__main">
          <SrCard className="sr-stack" style={{ order: 1 }}>
            <div>
              <h2 className="sr-h2">Pricing assumptions</h2>
              <p className="sr-sm" style={{ marginTop: 4 }}>
                These turn a duty change into margin, weekly profit drag, and a reprice suggestion. They are estimates you can tune any time.
              </p>
            </div>
            <div className="sr-grid-2 sr-grid-2--always">
              <TextField label="Landed cost, % of price" type="number" value={unitCost} onChange={setUnitCost} autoComplete="off" suffix="%" min={1} max={99} helpText="What a unit costs you, delivered." />
              <TextField label="Target margin" type="number" value={margin} onChange={setMargin} autoComplete="off" suffix="%" min={0} max={95} helpText="The margin a reprice should protect." />
            </div>
            <TextField label="Units sold per week" type="number" value={units} onChange={setUnits} autoComplete="off" suffix="units" min={0} helpText="A typical product across all channels. Drives the weekly drag figure." />
          </SrCard>

          <SrCard className="sr-stack" style={{ order: 2 }}>
            <div>
              <h2 className="sr-h2">Ship-to states</h2>
              <p className="sr-sm" style={{ marginTop: 4 }}>
                Each state adds a sales-tax rule that watches that state revenue site for its nexus threshold. Pick where most of your orders go.
              </p>
            </div>
            <div className="sr-states">
              {STATES.map((s) => (
                <Checkbox key={s.code} label={`${s.name} (${s.code})`} checked={states.includes(s.code)} onChange={(v) => setStates((prev) => (v ? Array.from(new Set([...prev, s.code])) : prev.filter((x) => x !== s.code)))} />
              ))}
            </div>
            {selected.length ? (
              <div className="sr-stack" style={{ paddingTop: 4 }}>
                <div>
                  <h3 className="sr-h3">Sales into each state this year</h3>
                  <p className="sr-xs" style={{ marginTop: 2 }}>
                    Optional. Fills the nexus bars on the Watchlist so you can see how close you are to each limit.
                  </p>
                </div>
                <div className="sr-grid-2 sr-grid-2--always">
                  {selected.map((s) => (
                    <TextField key={s.code} label={s.name} type="number" prefix="$" value={stateSales[s.code] ?? ""} onChange={(v) => setStateSales((prev) => ({ ...prev, [s.code]: v }))} autoComplete="off" placeholder="0" min={0} />
                  ))}
                </div>
              </div>
            ) : null}
          </SrCard>

          <SrCard className="sr-stack" style={{ order: 3 }}>
            <h2 className="sr-h2">Telegram</h2>
            <TextField
              label="Chat id"
              value={telegram}
              onChange={setTelegram}
              autoComplete="off"
              placeholder="123456789"
              helpText={data?.account.telegram_configured ? "Alerts are delivered to this chat." : "Set TELEGRAM_BOT_TOKEN on the server, message your bot once, then put your chat id here."}
            />
          </SrCard>

          <div className="sr-row" style={{ order: 4, justifyContent: "flex-end" }}>
            <Button variant="primary" onClick={save} loading={saving} disabled={!data}>
              Save settings
            </Button>
          </div>
        </div>

        <div className="sr-hud__aside">
          <SrCard className="sr-stack" style={{ order: 5 }}>
            <div>
              <h2 className="sr-h2">Chrome extension</h2>
              <p className="sr-sm" style={{ marginTop: 4 }}>
                Install it from the repository (extension/dist), open its popup, and paste this URL and token. Then hover any listing on Etsy, Shopify, or Amazon and press Alt+Shift+S.
              </p>
            </div>
            <TextField label="Shop Rules URL" value={origin} readOnly autoComplete="off" />
            <TextField label="Account token" value={data?.account.token ?? ""} readOnly autoComplete="off" connectedRight={<Button onClick={copyToken}>{copied ? "Copied" : "Copy"}</Button>} />
            <p className="sr-xs">The token identifies this workspace. Anyone with it can read your watch list, so treat it like a password.</p>
          </SrCard>

          <SrCard style={{ order: 6 }}>
            <h2 className="sr-h2" style={{ marginBottom: 6 }}>
              Status
            </h2>
            <KV
              rows={[
                ["Web access", <StatusPill key="w" tone="success">{health.data?.tavily_mode === "keyed" ? "Tavily, keyed" : "Tavily, keyless"}</StatusPill>],
                ["Models", health.data?.nemotron_configured ? <StatusPill key="m" tone="success">Nemotron ready</StatusPill> : <StatusPill key="m" tone="critical">Missing NEBIUS_API_KEY</StatusPill>],
                ["Storage", health.data?.storage_configured ? <StatusPill key="s" tone="success">Vercel Blob</StatusPill> : <StatusPill key="s" tone="critical">Missing BLOB_READ_WRITE_TOKEN</StatusPill>],
              ]}
            />
            <p className="sr-xs" style={{ marginTop: 8 }}>
              <span className="sr-mono">{health.data?.models?.nano}</span> handles fast calls. <span className="sr-mono">{health.data?.models?.ultra}</span> makes the rule decisions.
            </p>
            <p className="sr-xs" style={{ marginTop: 8 }}>
              Your watch list, alerts, price history, and standing instructions live in one private document per workspace. Self-host with your own Vercel Blob or Postgres to keep everything under your control.
            </p>
          </SrCard>
        </div>
      </div>
    </div>
  );
}
