"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/client";
import type { AccountRow, AlertRow, ProductRow } from "@/lib/db";
import { Chip, ChipRow, EmptyCard, groupAlertsByProduct, PageError, PriorityGroup, SectionHead, Skeleton, sortAlerts, SrButton, StatusPill } from "@/components/stitch";

type Tab = "new" | "actioned" | "dismissed" | "all";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "new", label: "Open" },
  { id: "actioned", label: "Done" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
];

export default function AlertsPage() {
  const [tab, setTab] = useState<Tab>("new");
  const alerts = useApi<{ alerts: AlertRow[] }>("/api/alerts?status=all");
  const products = useApi<{ products: ProductRow[] }>("/api/products");
  const account = useApi<{ account: AccountRow }>("/api/account");

  const settings = account.data?.account.settings;
  const productMap = useMemo(() => new Map((products.data?.products ?? []).map((p) => [p.id, p])), [products.data]);
  const all = useMemo(() => alerts.data?.alerts ?? [], [alerts.data]);
  const counts: Record<Tab, number> = {
    new: all.filter((a) => a.status === "new").length,
    actioned: all.filter((a) => a.status === "actioned").length,
    dismissed: all.filter((a) => a.status === "dismissed").length,
    all: all.length,
  };
  const list = useMemo(() => {
    const rows = tab === "all" ? all : all.filter((a) => a.status === tab);
    return tab === "new" ? sortAlerts(rows, productMap, settings) : [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [all, tab, productMap, settings]);

  const empty: Record<Tab, { title: string; text: string }> = {
    new: { title: "No open alerts", text: "Nothing is waiting on you. Checks run on their own schedule, or open a product to run one now." },
    actioned: { title: "Nothing marked done yet", text: "When you draft a reprice or mark an alert done, it moves here." },
    dismissed: { title: "Nothing dismissed", text: "Dismiss an alert with a reason and Shop Rules learns a standing instruction so it does not come back." },
    all: { title: "No alerts yet", text: "Watch a product and run a check to search the official sources for each rule." },
  };

  if (alerts.error) return <PageError title="Alerts" subtitle="Every alert quotes the official source." error={alerts.error ?? ""} status={alerts.status} onRetry={() => { alerts.refresh(); products.refresh(); account.refresh(); }} />;

  return (
    <div className="sr-page">
      <div className="sr-topline">
        <div className="sr-grow">
          <h1 className="sr-h1">Alerts</h1>
          <p className="sr-sm" style={{ marginTop: 4 }}>
            Every alert quotes the official source. The verifier shows what it kept and what it dropped.
          </p>
        </div>
        {alerts.data ? (
          <StatusPill tone={counts.new > 0 ? "critical" : "success"} caps={false}>
            {counts.new} open
          </StatusPill>
        ) : null}
      </div>

      <ChipRow label="Alert status">
        {TABS.map((t) => (
          <Chip key={t.id} active={tab === t.id} count={counts[t.id]} onClick={() => setTab(t.id)}>
            {t.label}
          </Chip>
        ))}
      </ChipRow>

      <section className="sr-stack">
        <SectionHead title={TABS.find((t) => t.id === tab)?.label ?? "Alerts"} aside={tab === "new" && list.length > 1 ? "One card per product, by severity then weekly margin drag" : undefined} />
        {alerts.loading || products.loading ? (
          <Skeleton lines={4} />
        ) : list.length === 0 ? (
          <EmptyCard title={empty[tab].title} text={empty[tab].text}>
            <SrButton href="/products">Open Inspector</SrButton>
          </EmptyCard>
        ) : (
          <div className="sr-priority">
            {groupAlertsByProduct(list).map((g) => (
              <PriorityGroup key={g.productId} product={productMap.get(g.productId)} alerts={g.alerts} settings={settings} fallbackTitle={g.alerts[0]?.product_title} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
