"use client";

import { Badge, BlockStack, InlineStack, Text, Tooltip } from "@shopify/polaris";
import type { ReactNode } from "react";

export function FamilyBadge({ family }: { family: string }) {
  const map: Record<string, { label: string; tone: "info" | "attention" | "success" | "new" | "warning" | "critical" | undefined }> = {
    tariff: { label: "Tariff", tone: "attention" },
    safety: { label: "Product safety", tone: "critical" },
    tax: { label: "Sales tax", tone: "info" },
    policy: { label: "Marketplace policy", tone: "new" },
  };
  const m = map[family] ?? { label: family, tone: undefined };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "high") return <Badge tone="critical">High</Badge>;
  if (severity === "medium") return <Badge tone="warning">Medium</Badge>;
  return <Badge>Low</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "new") return <Badge tone="attention" progress="incomplete">Open</Badge>;
  if (status === "actioned") return <Badge tone="success" progress="complete">Done</Badge>;
  return <Badge progress="complete">Dismissed</Badge>;
}

export function MarketplaceBadge({ marketplace }: { marketplace: string }) {
  const label = marketplace === "amazon" ? "Amazon" : marketplace === "etsy" ? "Etsy" : marketplace === "shopify" ? "Shopify" : "Web";
  return <Badge tone={marketplace === "shopify" ? "success" : marketplace === "amazon" ? "warning" : marketplace === "etsy" ? "attention" : undefined}>{label}</Badge>;
}

export function EvidenceBar({ proposed, backed, rejected, compact = false }: { proposed: number; backed: number; rejected: number; compact?: boolean }) {
  const total = Math.max(proposed, 1);
  const b = (backed / total) * 100;
  const r = (rejected / total) * 100;
  return (
    <BlockStack gap="100">
      <Tooltip content={`${backed} backed by source text, ${rejected} rejected by the verifier`}>
        <div className="sr-evidence-bar" aria-label="Evidence">
          <span style={{ width: `${b}%`, background: "#29845a" }} />
          <span style={{ width: `${r}%`, background: "#e51c00" }} />
        </div>
      </Tooltip>
      {!compact && (
        <Text as="span" variant="bodySm" tone="subdued">
          {proposed} proposed, {backed} backed, {rejected} rejected
        </Text>
      )}
    </BlockStack>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="p" variant="headingLg">
        {value}
      </Text>
      {hint ? (
        <Text as="span" variant="bodySm" tone="subdued">
          {hint}
        </Text>
      ) : null}
    </BlockStack>
  );
}

export function Sparkline({ points, markers = [] }: { points: Array<{ at: string; price: number }>; markers?: string[] }) {
  if (points.length < 2) {
    return (
      <Text as="p" tone="subdued" variant="bodySm">
        {points.length === 1 ? `History starts now at ${points[0].price.toFixed(2)}.` : "No price points yet."}
      </Text>
    );
  }
  const w = 600;
  const h = 56;
  const xs = points.map((p) => new Date(p.at).getTime());
  const ys = points.map((p) => p.price);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs) || minX + 1;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = maxY - minY || 1;
  const px = (x: number) => ((x - minX) / (maxX - minX || 1)) * (w - 8) + 4;
  const py = (y: number) => h - 6 - ((y - minY) / spanY) * (h - 12);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(xs[i]).toFixed(1)},${py(p.price).toFixed(1)}`).join(" ");
  return (
    <svg className="sr-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Price history">
      <path d={d} fill="none" stroke="#008060" strokeWidth="2" />
      {markers.map((m, i) => {
        const x = px(new Date(m).getTime());
        return <line key={i} x1={x} x2={x} y1={2} y2={h - 2} stroke="#e51c00" strokeDasharray="3 3" strokeWidth="1" />;
      })}
      <circle cx={px(xs[xs.length - 1])} cy={py(ys[ys.length - 1])} r="3" fill="#008060" />
    </svg>
  );
}

export function KeyValue({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <BlockStack gap="150">
      {rows.map(([k, v]) => (
        <InlineStack key={k} align="space-between" blockAlign="start" gap="400" wrap={false}>
          <Text as="span" tone="subdued" variant="bodySm">
            {k}
          </Text>
          <div style={{ textAlign: "right", maxWidth: "70%" }}>{typeof v === "string" ? <Text as="span" variant="bodySm">{v}</Text> : v}</div>
        </InlineStack>
      ))}
    </BlockStack>
  );
}
