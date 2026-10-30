"use client";

import { Banner } from "@shopify/polaris";
import { ChevronRightIcon } from "@shopify/polaris-icons";
import NextLink from "next/link";
import { useState } from "react";
import { timeAgo, useApi } from "@/lib/client";
import { fmtMoney } from "@/lib/economics";
import { deltaSummary, sparklinePath, toChartPoints } from "@/lib/chart";
import type { ProductRow } from "@/lib/db";
import { EmptyCard, marketplaceLabel, PageError, ProductThumb, Skeleton, SrButton, SrCard, StatusPill } from "@/components/stitch";
import { WatchForm } from "@/components/WatchForm";

export default function InspectorListPage() {
  const [error, setError] = useState<string | null>(null);
  const list = useApi<{ products: ProductRow[] }>("/api/products");
  const { data, loading } = list;
  const products = data?.products ?? [];
  const openTotal = products.reduce((s, p) => s + (p.open_alerts ?? 0), 0);


  if (list.error) return <PageError title="Inspector" subtitle="Every product you watch. Tap one for its price math, open alerts, and compliance audit." error={list.error ?? ""} status={list.status} onRetry={list.refresh} />;

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
        <WatchForm placeholder="https://www.amazon.com/dp/..." buttonLabel="Watch product" />
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
                <PriceCell points={p.price_points ?? []} />
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

// Change since first seen and a 30-point sparkline, from the product's stored
// price points. Gain and loss use the shared tokens; no color without a number.
function PriceCell({ points }: { points: Array<{ at: string; price: number }> }) {
  const pts = toChartPoints(points);
  const d = deltaSummary(pts);
  if (!d || pts.length < 2) return <span className="sr-xs sr-desktop-only" style={{ width: 120, textAlign: "right" }}>no history yet</span>;
  const up = d.direction === "up";
  const flat = d.direction === "flat";
  const color = flat ? "var(--sr-text-2)" : up ? "var(--sr-primary)" : "var(--sr-critical)";
  const { path } = sparklinePath(pts, 84, 22);
  return (
    <div className="sr-desktop-only sr-stack" style={{ alignItems: "flex-end", gap: 2, width: 120 }}>
      <span className="sr-xs sr-num" style={{ color, fontWeight: 600 }}>
        {flat ? "=" : up ? "\u2191" : "\u2193"} {Math.abs(d.pct).toFixed(1)}% since added
      </span>
      <svg width="84" height="22" viewBox="0 0 84 22" aria-hidden focusable="false">
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}
