"use client";

import { useEffect, useState } from "react";
import { Button, TextField } from "@shopify/polaris";
import { api, useApi } from "@/lib/client";
import type { AccountRow } from "@/lib/db";

// Price tracking threshold: a move of at least this percent between two
// observations raises a price_change alert. Saved on its own so it does not
// depend on the rest of the settings form.
export function PriceSettings() {
  const account = useApi<{ account: AccountRow }>("/api/account");
  const [value, setValue] = useState("3");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const v = account.data?.account.settings?.price_change_pct;
    if (typeof v === "number") setValue(String(v));
  }, [account.data]);

  async function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setNote("Enter a percent between 0 and 100.");
      return;
    }
    setSaving(true);
    setNote(null);
    try {
      await api("/api/account", { method: "PATCH", json: { settings: { price_change_pct: n } } });
      setNote(`Saved. Price moves of ${n}% or more raise an alert.`);
      account.refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sr-stack sr-stack--tight">
      <TextField label="Alert on price moves of at least" type="number" suffix="%" value={value} onChange={setValue} autoComplete="off" min={0} max={100} step={0.5} helpText="Points come from the extension when you visit a watched page and from the daily price refresh." connectedRight={<Button onClick={save} loading={saving}>Save</Button>} />
      {note ? <p className="sr-xs">{note}</p> : null}
    </div>
  );
}
