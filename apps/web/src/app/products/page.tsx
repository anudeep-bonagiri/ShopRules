"use client";

import { Banner, Button, TextField } from "@shopify/polaris";
import { ChevronRightIcon } from "@shopify/polaris-icons";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, timeAgo, useApi } from "@/lib/client";
import { fmtMoney } from "@/lib/economics";
import type { ProductRow } from "@/lib/db";
import { EmptyCard, marketplaceLabel, ProductThumb, Skeleton, SrButton, SrCard, StatusPill } from "@/components/stitch";

export default function InspectorListPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data, loading } = useApi<{ products: ProductRow[] }>("/api/products");
  const products = data?.products ?? [];
  const openTotal = products.reduce((s, p) => s + (p.open_alerts ?? 0), 0);

  async function add() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ product: ProductRow }>("/api/products", { method: "POST", json: { url: url.trim() } });
      setUrl("");
      router.push(`/products/${r.product.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sr-page">
      <div className="sr-topline">
        <div className="sr-grow">
          <h1 className="sr-h1">Inspector</h1>
          <p className="sr-sm" style={{ marginTop: 4 }}>
            Every product you watch. Tap one for its price math, open alerts, and compliance audit.
          </p>
        </div>
        {data ? (
          <StatusPill tone={openTotal > 0 ? "critical" : products.length ? "success" : "neutral"} caps={false}>
            {products.length} product{products.length === 1 ? "" : "s"}
            {openTotal > 0 ? `, ${openTotal} open alert${openTotal === 1 ? "" : "s"}` : ""}
          </StatusPill>
        ) : null}
      </div>

      {error ? (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          <p>{error}</p>
        </Banner>
      ) : null}

      <SrCard className="sr-stack">
        <h2 className="sr-h2">Watch a listing</h2>
        <TextField
          label="Listing URL"
          labelHidden
          value={url}
          onChange={setUrl}
          autoComplete="off"
          placeholder="https://www.amazon.com/dp/..."
          clearButton
          onClearButtonClick={() => setUrl("")}
          connectedRight={
            <Button variant="primary" onClick={add} loading={busy} disabled={!url.trim()}>
              Watch product
            </Button>
          }
        />
      </SrCard>

      {loading ? (
        <Skeleton lines={4} />
      ) : products.length === 0 ? (
        <EmptyCard title="No products yet" text="Paste a listing URL above, or load the demo shop from the Watchlist to see three products with live checks.">
          <SrButton href="/">Go to Watchlist</SrButton>
        </EmptyCard>
      ) : (
        <SrCard flush>
          <div className="sr-rows">
            {products.map((p) => (
              <NextLink key={p.id} href={`/products/${p.id}`} className="sr-prow">
                <ProductThumb product={p} />
                <div className="sr-grow sr-stack" style={{ gap: 4 }}>
                  <h3 className="sr-h3 sr-clamp2" style={{ fontSize: 14 }}>
                    {p.title}
                  </h3>
                  <div className="sr-row" style={{ gap: 6 }}>
                    <StatusPill caps={false}>{marketplaceLabel(p.marketplace)}</StatusPill>
                    <span className="sr-xs sr-truncate">
                      {p.profile?.product_type || p.profile?.category || "Product"}
                      {p.last_checked_at ? `, checked ${timeAgo(p.last_checked_at)}` : ", not checked yet"}
                    </span>
                  </div>
                </div>
                <div className="sr-right sr-stack" style={{ gap: 4, alignItems: "flex-end" }}>
                  <span className="sr-body sr-num" style={{ fontWeight: 600 }}>
                    {fmtMoney(p.price, p.currency || "USD")}
                  </span>
                  {p.open_alerts ? (
                    <StatusPill tone="critical">
                      {p.open_alerts} open
                    </StatusPill>
                  ) : (
                    <StatusPill tone={p.last_checked_at ? "success" : "neutral"}>{p.last_checked_at ? "Clear" : "Queued"}</StatusPill>
                  )}
                </div>
                <span className="sr-audit__icon" style={{ color: "var(--sr-text-2)", fill: "var(--sr-text-2)" }} aria-hidden>
                  <ChevronRightIcon />
                </span>
              </NextLink>
            ))}
          </div>
        </SrCard>
      )}
    </div>
  );
}
