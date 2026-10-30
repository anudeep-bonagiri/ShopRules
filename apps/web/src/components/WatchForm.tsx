"use client";

import { Button, TextField } from "@shopify/polaris";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/client";
import type { CheckRunRecord, ProductRow } from "@/lib/db";
import { cx, StatusPill } from "@/components/stitch";

// The "Watch a listing" form used on the Watchlist and the Inspector. Enter
// submits. While the server reads, classifies, and seeds the listing, the form
// polls GET /api/runs/[id] and shows the three steps; failures stay inline with
// the server's reason (reader blocked, not a product page, 25-product cap).

const STEPS: Array<{ key: "read" | "classify" | "seed"; label: string }> = [
  { key: "read", label: "Reading listing" },
  { key: "classify", label: "Classifying" },
  { key: "seed", label: "Seeding rules" },
];

function newRunId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function WatchForm({
  placeholder = "https://www.etsy.com/listing/...",
  buttonLabel = "Watch product",
  disabled,
  onAdded,
  aside,
  compact,
}: {
  placeholder?: string;
  buttonLabel?: string;
  disabled?: boolean;
  /** Called after a successful add; by default the form navigates to the product. */
  onAdded?: (product: ProductRow, existing: boolean) => void;
  /** Rendered to the right of the field on wide screens (the demo button). */
  aside?: ReactNode;
  compact?: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<CheckRunRecord | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [busy]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const target = url.trim();
    if (!target || busy || disabled) return;
    const runId = newRunId();
    setBusy(true);
    setError(null);
    setProgress(null);
    setElapsed(0);
    pollRef.current = window.setInterval(() => {
      api<{ run: CheckRunRecord }>(`/api/runs/${runId}`)
        .then((r) => setProgress(r.run))
        .catch(() => undefined);
    }, 2000);
    try {
      const r = await api<{ product: ProductRow; existing: boolean }>("/api/products", { method: "POST", json: { url: target, run_id: runId } });
      setUrl("");
      if (onAdded) onAdded(r.product, r.existing);
      else router.push(`/products/${r.product.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  const steps = progress?.steps ?? (busy ? STEPS.map((s, i) => ({ ...s, status: i === 0 ? ("active" as const) : ("queued" as const) })) : null);

  return (
    <form onSubmit={submit} className={cx("sr-stack", compact && "sr-stack--tight")} aria-busy={busy}>
      <div className="sr-row sr-row--wrap" style={{ gap: 8 }}>
        <div className="sr-grow" style={{ minWidth: 240 }}>
          <TextField
            label="Listing URL"
            labelHidden
            value={url}
            onChange={setUrl}
            autoComplete="off"
            inputMode="url"
            placeholder={placeholder}
            clearButton
            onClearButtonClick={() => setUrl("")}
            disabled={busy}
            error={error ?? undefined}
            connectedRight={
              <Button variant="primary" submit loading={busy} disabled={!url.trim() || disabled}>
                {buttonLabel}
              </Button>
            }
          />
        </div>
        {aside}
      </div>
      {steps ? (
        <div className="sr-steps" role="status" aria-live="polite">
          {steps.map((s, i) => {
            const tone = s.status === "done" ? "success" : s.status === "active" ? "info" : s.status === "error" ? "critical" : "neutral";
            return (
              <div key={s.key} className={cx("sr-steps__item", `sr-steps__item--${s.status}`)}>
                <StatusPill tone={tone} live={s.status === "active"} dot={s.status !== "active"} caps={false}>
                  {i + 1}. {s.label}
                </StatusPill>
                {"detail" in s && s.detail ? <span className="sr-xs sr-num">{s.detail}</span> : null}
              </div>
            );
          })}
          <span className="sr-xs sr-num sr-steps__clock">{elapsed}s, usually 20 to 40</span>
        </div>
      ) : null}
    </form>
  );
}
