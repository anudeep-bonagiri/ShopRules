"use client";

import { Banner, Button, Checkbox, Select, TextField } from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import { api, useApi } from "@/lib/client";
import type { AccountRow } from "@/lib/db";
import { STATES } from "@/lib/rules-catalog";
import { KV, SrCard, StatusPill } from "@/components/stitch";
import { DEFAULT_DUTIABLE_SHARE } from "@/lib/pricing";
import { nexusSeed } from "@/lib/nexus";
import { ConnectExtension } from "@/components/ConnectExtension";
import { PriceSettings } from "@/components/PriceSettings";

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
  const [dutiable, setDutiable] = useState(String(Math.round(DEFAULT_DUTIABLE_SHARE * 100)));
  const [rounding, setRounding] = useState("0.5");
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<{ source: string; orders_seen: number; orders_skipped: number; years: number[]; states: string[] } | null>(null);
  const [rotateStep, setRotateStep] = useState<0 | 1>(0);
  const [rotating, setRotating] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    if (new URLSearchParams(window.location.search).get("open") === "invalid") {
      setError("That link's token was not recognized, so this browser kept its own workspace. Ask for a fresh link from Settings on the other device.");
    }
  }, []);

  useEffect(() => {
    if (!data) return;
    const s = data.account.settings;
    setStates(s.ship_to_states ?? []);
    setMargin(String(s.target_margin_pct ?? 35));
    setUnitCost(String(s.unit_cost_pct ?? 45));
    setUnits(String(s.units_per_week ?? 20));
    setDutiable(String(Math.round((s.dutiable_share ?? DEFAULT_DUTIABLE_SHARE) * 100)));
    setRounding(String(s.rounding ?? 0.5));
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
      const r = await api<{ reseeded?: number }>("/api/account", {
        method: "PATCH",
        json: {
          settings: {
            ship_to_states: states,
            target_margin_pct: Number(margin),
            unit_cost_pct: Number(unitCost),
            units_per_week: Number(units),
            dutiable_share: Math.min(Math.max(Number(dutiable) / 100, 0), 1),
            rounding: Number(rounding),
            state_sales: sales,
          },
          telegram_chat_id: telegram || null,
        },
      });
      setNotice(r.reseeded ? `Saved. Tax rules reseeded for your products: ${r.reseeded} rule${r.reseeded === 1 ? "" : "s"} added or removed. Products keep any numbers you set on them.` : "Saved. These are the workspace defaults; a product can override any of them on its own page.");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function importOrders(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    setError(null);
    setImportSummary(null);
    try {
      const csv = await file.text();
      const r = await api<{ summary: { source: string; orders_seen: number; orders_skipped: number; years: number[]; states: string[] } }>("/api/account/sales-import", { method: "POST", json: { csv } });
      setImportSummary(r.summary);
      setNotice(`Imported ${r.summary.orders_seen} orders from your ${r.summary.source === "shopify" ? "Shopify" : "Etsy"} export. Only per-state totals were kept.`);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function rotate() {
    if (rotateStep === 0) {
      setRotateStep(1);
      return;
    }
    setRotating(true);
    setError(null);
    try {
      await api("/api/account/rotate", { method: "POST" });
      setNotice("New token issued. The old token, the extension connection, and any open-on-another-device link stopped working. Reconnect the extension with the new token.");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRotating(false);
      setRotateStep(0);
    }
  }

  async function copyOpenLink() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(`${origin}/open?token=${data.account.token}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      setError("Could not copy. Select the link and copy it by hand.");
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
              <h2 className="sr-h2">Pricing defaults</h2>
              <p className="sr-sm" style={{ marginTop: 4 }}>
                Workspace defaults that turn a duty change into margin, weekly profit drag, and a reprice suggestion. Any product can override them on its own page; a product shows which it is using.
              </p>
            </div>
            <div className="sr-grid-2 sr-grid-2--always">
              <TextField label="Landed cost, % of price" type="number" value={unitCost} onChange={setUnitCost} autoComplete="off" suffix="%" min={1} max={99} helpText="What a unit costs you, delivered." />
              <TextField label="Target margin" type="number" value={margin} onChange={setMargin} autoComplete="off" suffix="%" min={0} max={95} helpText="The margin a reprice should protect." />
            </div>
            <TextField label="Units sold per week" type="number" value={units} onChange={setUnits} autoComplete="off" suffix="units" min={0} helpText="A typical product across all channels. Drives the weekly drag figure." />
            <div className="sr-grid-2 sr-grid-2--always">
              <TextField label="Customs value share of landed cost" type="number" value={dutiable} onChange={setDutiable} autoComplete="off" suffix="%" min={0} max={100} helpText="Duty applies to the goods' customs value, not to freight and handling. 85% is a common split." />
              <Select
                label="Round suggested prices to"
                options={[
                  { label: "Nearest $0.50", value: "0.5" },
                  { label: "x.99 endings", value: "0.99" },
                  { label: "Nearest cent", value: "0.01" },
                ]}
                value={rounding}
                onChange={setRounding}
                helpText="How a reprice suggestion is rounded."
              />
            </div>
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
                    <TextField key={s.code} label={s.name} type="number" prefix="$" value={stateSales[s.code] ?? ""} onChange={(v) => setStateSales((prev) => ({ ...prev, [s.code]: v }))} autoComplete="off" placeholder="0" min={0} helpText={nexusSeed(s.code) ? `Seed limit ${nexusSeed(s.code)!.dollars != null ? `$${nexusSeed(s.code)!.dollars!.toLocaleString("en-US")}` : ""}${nexusSeed(s.code)!.transactions != null ? ` ${nexusSeed(s.code)!.operator ?? "or"} ${nexusSeed(s.code)!.transactions} orders` : ""}` : undefined} />
                  ))}
                </div>
              </div>
            ) : null}
            <div className="sr-stack sr-stack--tight" style={{ paddingTop: 4 }}>
              <div>
                <h3 className="sr-h3">Import your orders instead</h3>
                <p className="sr-xs" style={{ marginTop: 2 }}>
                  Upload a Shopify Orders export or an Etsy Orders CSV. Shop Rules totals dollars and order counts per ship-to state for this year and last year, then throws the rows away. Both tests of each state&apos;s limit light up.
                </p>
              </div>
              <div className="sr-row sr-row--wrap" style={{ gap: 8 }}>
                <input ref={fileRef} id="orders-csv" type="file" accept=".csv,text/csv" className="sr-file" aria-label="Orders CSV export" disabled={importing} onChange={(e) => void importOrders(e.target.files?.[0])} />
                {importing ? <StatusPill tone="info" live caps={false}>Reading orders</StatusPill> : null}
              </div>
              {importSummary ? (
                <p className="sr-xs sr-num" role="status" aria-live="polite">
                  {importSummary.orders_seen} orders read, {importSummary.orders_skipped} skipped (refunds, missing state, older than last year), {importSummary.states.length} state{importSummary.states.length === 1 ? "" : "s"}, years {importSummary.years.join(", ") || "none"}.
                </p>
              ) : null}
              {data?.account.settings.state_sales_by_year ? (
                <div className="sr-rows">
                  {Object.entries(data.account.settings.state_sales_by_year)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([year, byState]) => (
                      <div key={year} className="sr-stack sr-stack--tight" style={{ padding: "8px 0" }}>
                        <p className="sr-xs" style={{ fontWeight: 600 }}>
                          {year}
                          {data.account.settings.sales_import ? ` from ${data.account.settings.sales_import.source === "shopify" ? "Shopify" : "Etsy"}, imported ${new Date(data.account.settings.sales_import.imported_at).toLocaleDateString("en-US")}` : ""}
                        </p>
                        <div className="sr-row sr-row--wrap sr-xs sr-num" style={{ gap: "4px 12px" }}>
                          {Object.entries(byState)
                            .sort(([, a], [, b]) => b.dollars - a.dollars)
                            .map(([st, v]) => (
                              <span key={st}>
                                {st} ${Math.round(v.dollars).toLocaleString("en-US")}, {v.orders} order{v.orders === 1 ? "" : "s"}
                              </span>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
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
            <ConnectExtension token={data?.account.token} />
            <TextField label="Shop Rules URL" value={origin} readOnly autoComplete="off" />
            <TextField label="Account token" value={data?.account.token ?? ""} readOnly autoComplete="off" connectedRight={<Button onClick={copyToken}>{copied ? "Copied" : "Copy"}</Button>} />
            <p className="sr-xs">The token identifies this workspace. Anyone with it can read your watch list, so treat it like a password.</p>
          </SrCard>

          <SrCard className="sr-stack" style={{ order: 5 }}>
            <div>
              <h2 className="sr-h2">This workspace elsewhere</h2>
              <p className="sr-sm" style={{ marginTop: 4 }}>
                Open the same watch list on your phone or another browser. The link carries your token, so share it only with yourself.
              </p>
            </div>
            <TextField label="Open on another device" value={data ? `${origin}/open?token=${data.account.token}` : ""} readOnly autoComplete="off" connectedRight={<Button onClick={copyOpenLink} disabled={!data}>{linkCopied ? "Copied" : "Copy link"}</Button>} />
            <div className="sr-row sr-row--between sr-row--wrap" style={{ gap: 8 }}>
              <span className="sr-xs">Lost the token or shared it by mistake? Rotate it. The extension and old links must reconnect.</span>
              <Button tone="critical" variant={rotateStep === 1 ? "primary" : undefined} onClick={rotate} loading={rotating} disabled={!data}>
                {rotateStep === 1 ? "Confirm: rotate token" : "Rotate token"}
              </Button>
            </div>
          </SrCard>

          <SrCard className="sr-stack" style={{ order: 6 }}>
            <h2 className="sr-h2">Price tracking</h2>
            <PriceSettings />
          </SrCard>

          <SrCard style={{ order: 7 }}>
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
