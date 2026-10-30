"use client";

import { Banner, Modal, TextField } from "@shopify/polaris";
import NextLink from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { api, timeAgo, useApi } from "@/lib/client";
import type { AccountRow, AlertRow, ProductRow, RuleRow, SkillRow } from "@/lib/db";
import { fmtMoney, fmtPct } from "@/lib/economics";
import { FAMILY_LABEL } from "@/lib/rules-catalog";
import { EvidenceBar } from "@/components/ui";
import { AccentCard, alertEconomics, alertTone, BackLink, DutyImpact, effectiveLabel, fmtDate, hostOf, KV, marketplaceLabel, ProductThumb, RepriceBlock, Skeleton, sourceDomain, SrButton, SrCard, StatusPill } from "@/components/stitch";

type Detail = { alert: AlertRow; product: ProductRow | null; rule: RuleRow | null; sources: AlertRow["sources"] };

const ACTION_LABEL: Record<string, string> = {
  reprice: "Reprice",
  compliance_step: "Compliance step",
  register_tax: "Tax registration",
  review: "Needs review",
  none: "No action",
};

export default function AlertPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data, loading, error, refresh } = useApi<Detail>(id ? `/api/alerts/${id}` : null);
  const account = useApi<{ account: AccountRow }>("/api/account");
  const settings = account.data?.account.settings;
  const [dismissOpen, setDismissOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"done" | "dismiss" | "reopen" | "draft" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function setStatus(status: "actioned" | "dismissed" | "new", kind: "done" | "dismiss" | "reopen" | "draft", message?: string) {
    setBusy(kind);
    setActionError(null);
    try {
      const r = await api<{ alert: AlertRow; skill: SkillRow | null }>(`/api/alerts/${id}`, { method: "PATCH", json: { status, reason } });
      setDismissOpen(false);
      setReason("");
      setNotice(
        message ??
          (status === "dismissed"
            ? r.skill
              ? `Dismissed. Learned a standing instruction: "${r.skill.text}"`
              : "Dismissed."
            : status === "actioned"
              ? "Marked done."
              : "Reopened."),
      );
      refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function draftReprice(price: number, currency: string) {
    try {
      await navigator.clipboard.writeText(price.toFixed(2));
    } catch {
      // Clipboard can be blocked outside a secure context; the price stays on screen.
    }
    await setStatus("actioned", "draft", `New price ${fmtMoney(price, currency)} copied. Paste it into your listing.`);
  }

  if (error) {
    return (
      <div className="sr-page sr-page--narrow">
        <BackLink href="/alerts">Alerts</BackLink>
        <Banner tone="critical">
          <p>{error}</p>
        </Banner>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="sr-page">
        <BackLink href="/alerts">Alerts</BackLink>
        <Skeleton lines={3} />
        <Skeleton lines={4} />
      </div>
    );
  }

  const { alert, product, rule } = data;
  const act = alert.action;
  const tone = alertTone(alert);
  const currency = product?.currency || settings?.currency || "USD";
  const econ = alertEconomics(alert, product, settings);
  const hasDuty = Boolean(econ && econ.new_margin_pct != null);
  const units = settings?.units_per_week ?? 20;
  const domain = sourceDomain(alert);
  const hts = product?.profile?.hts_candidates?.[0];
  const isOpen = alert.status === "new";
  const suggestedRaw = econ?.suggested_price ?? null;
  // A suggestion equal to the current price is not a reprice; show the steps instead.
  const suggested = suggestedRaw != null && product?.price != null && Math.abs(suggestedRaw - product.price) < 0.005 ? null : suggestedRaw;
  const effective = fmtDate(alert.impact?.effective_date);
  const when = effectiveLabel(alert.impact?.effective_date);

  return (
    <div className="sr-page">
      <BackLink href="/alerts">Alerts</BackLink>

      {notice ? (
        <Banner tone="success" onDismiss={() => setNotice(null)}>
          <p>{notice}</p>
        </Banner>
      ) : null}
      {actionError ? (
        <Banner tone="critical" onDismiss={() => setActionError(null)}>
          <p>{actionError}</p>
        </Banner>
      ) : null}

      <div className="sr-hud">
        <div className="sr-hud__main">
          <AccentCard tone={tone} className="sr-stack" style={{ order: 1 }}>
            <div className="sr-accent-head">
              <div className="sr-grow">
                <h1 className="sr-h2">{alert.headline}</h1>
                <p className="sr-sm sr-num" style={{ marginTop: 4 }}>
                  {hts?.code ? `HS ${hts.code}, ` : ""}
                  {domain ?? FAMILY_LABEL[alert.family]}
                  {when ? `, ${when}` : ""}
                </p>
                <p className="sr-xs" style={{ marginTop: 4 }}>
                  {product ? (
                    <NextLink href={`/products/${product.id}`} className="sr-link">
                      {product.title}
                    </NextLink>
                  ) : (
                    "Product removed"
                  )}
                  {rule ? `, ${rule.title}` : ""}, {timeAgo(alert.created_at)}
                </p>
              </div>
              <StatusPill tone={tone} dot={isOpen}>
                {!isOpen ? (alert.status === "actioned" ? "Done" : "Dismissed") : alert.severity === "high" ? "Critical / Action needed" : "Review needed"}
              </StatusPill>
            </div>
            {hasDuty && econ ? (
              <DutyImpact econ={econ} tone={tone} currency={currency} units={units} />
            ) : (
              <div className="sr-card sr-row sr-row--between">
                <span className="sr-body" style={{ fontWeight: 500 }}>
                  {alert.relevance === "affects" ? "Applies to this product" : "Might apply to this product"}
                </span>
                <span className="sr-xs sr-right">{FAMILY_LABEL[alert.family]}</span>
              </div>
            )}
          </AccentCard>

          <SrCard className="sr-stack" style={{ order: 2 }}>
            <div className="sr-row sr-row--between">
              <h2 className="sr-h2">What to do</h2>
              <StatusPill tone={act.type === "none" ? "neutral" : "info"}>{ACTION_LABEL[act.type] ?? act.type}</StatusPill>
            </div>
            <p className="sr-body" style={{ fontWeight: 600 }}>
              {act.title}
            </p>
            {act.steps?.length ? (
              <ol className="sr-steps">
                {act.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            ) : null}
            {act.rationale ? <p className="sr-xs">{act.rationale}</p> : null}
            {isOpen && suggested != null ? (
              <div className="sr-inset">
                <RepriceBlock price={suggested} currency={currency} preservedPct={econ?.preserved_margin_pct ?? null} retailDelta={econ?.retail_delta ?? (product?.price != null ? suggested - product.price : null)} explanation={econ?.pricing?.explanation ?? null} onDraft={() => draftReprice(suggested, currency)} busy={busy === "draft"} />
              </div>
            ) : suggestedRaw != null ? (
              <p className="sr-xs sr-num">{suggested == null ? `The suggested price matches the current ${fmtMoney(suggestedRaw, currency)}, so no reprice is needed yet.` : `Suggested price was ${fmtMoney(suggestedRaw, currency)}.`}</p>
            ) : econ?.pricing && econ.pricing.strategy === "absorb" && econ.pricing.basis !== "none" ? (
              <p className="sr-xs">{econ.pricing.explanation}</p>
            ) : null}
            <div className="sr-row" style={{ gap: 8, flexWrap: "wrap" }}>
              {isOpen ? (
                <>
                  <SrButton variant={suggested != null ? "secondary" : "primary"} onClick={() => setStatus("actioned", "done")} loading={busy === "done"} disabled={busy != null && busy !== "done"}>
                    Mark done
                  </SrButton>
                  <SrButton onClick={() => setDismissOpen(true)} disabled={busy != null}>
                    Dismiss
                  </SrButton>
                </>
              ) : (
                <SrButton onClick={() => setStatus("new", "reopen")} loading={busy === "reopen"}>
                  Reopen
                </SrButton>
              )}
            </div>
          </SrCard>

          <SrCard className="sr-stack" style={{ order: 3 }}>
            <div className="sr-row sr-row--between">
              <h2 className="sr-h2">Evidence check</h2>
              <StatusPill tone={alert.backed > 0 ? "success" : "warning"} caps={false}>
                {alert.backed} of {alert.proposed} backed
              </StatusPill>
            </div>
            <EvidenceBar proposed={alert.proposed} backed={alert.backed} rejected={alert.rejected} />
            <p className="sr-xs">Each claim comes with a quote. A claim is kept only when that quote appears in the text read from the source. Rejected claims stay visible so you can see what was dropped.</p>
            {alert.claims.length === 0 ? (
              <p className="sr-sm">No claims were proposed for this alert.</p>
            ) : (
              <div className="sr-rows">
                {alert.claims.map((c, i) => (
                  <div key={i} className="sr-stack" style={{ padding: "12px 0", gap: 6 }}>
                    <div className="sr-row" style={{ gap: 8 }}>
                      {c.backed ? <StatusPill tone="success">Backed</StatusPill> : <StatusPill tone="critical">Rejected</StatusPill>}
                      <span className="sr-xs sr-truncate">{hostOf(c.matched_url ?? c.source_url) ?? c.source_url}</span>
                    </div>
                    <p className="sr-body" style={{ fontWeight: 600 }}>
                      {c.claim}
                    </p>
                    <blockquote className="sr-quote">{c.quote}</blockquote>
                    <a href={c.matched_url ?? c.source_url} target="_blank" rel="noopener noreferrer" className="sr-link" style={{ fontSize: 12 }}>
                      Open {hostOf(c.matched_url ?? c.source_url) ?? "source"}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </SrCard>
        </div>

        <div className="sr-hud__aside">
          <SrCard style={{ order: 4 }}>
            <h2 className="sr-h2" style={{ marginBottom: 6 }}>
              Impact
            </h2>
            <KV
              rows={[
                ["Relevance", alert.relevance === "affects" ? "Applies to this product" : "Might apply"],
                ["Severity", <StatusPill key="s" tone={tone}>{alert.severity}</StatusPill>],
                ["Effective date", effective ?? "Not stated"],
                ["Duty change", alert.impact.tariff_rate_change_pct != null ? `${alert.impact.tariff_rate_change_pct > 0 ? "+" : ""}${alert.impact.tariff_rate_change_pct} pts` : "n/a"],
                ["Est. cost change", alert.impact.estimated_cost_change_pct != null ? fmtPct(alert.impact.estimated_cost_change_pct, 1, true) : "n/a"],
                ["Rule", rule?.title ?? "n/a"],
              ]}
            />
          </SrCard>

          <SrCard className="sr-stack" style={{ order: 5 }}>
            <h2 className="sr-h2">Sources read</h2>
            {alert.sources.length === 0 ? (
              <p className="sr-sm">No sources recorded.</p>
            ) : (
              <div className="sr-rows">
                {alert.sources.map((s) => (
                  <div key={s.url} className="sr-stack" style={{ padding: "8px 0", gap: 2 }}>
                    <span className="sr-xs" style={{ fontWeight: 600, color: "var(--sr-text)" }}>
                      {s.domain}
                    </span>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="sr-link" style={{ fontSize: 12, display: "block", wordBreak: "break-word" }}>
                      {s.title || s.url}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </SrCard>

          {product ? (
            <SrCard className="sr-row" style={{ order: 6, gap: 12 }}>
              <ProductThumb product={product} />
              <div className="sr-grow sr-stack" style={{ gap: 2 }}>
                <span className="sr-body sr-truncate" style={{ fontWeight: 600 }}>
                  {product.title}
                </span>
                <span className="sr-xs sr-num">
                  {fmtMoney(product.price, currency)} on {marketplaceLabel(product.marketplace)}
                </span>
              </div>
              <SrButton href={`/products/${product.id}`}>Inspect</SrButton>
            </SrCard>
          ) : null}
        </div>
      </div>

      <Modal
        open={dismissOpen}
        onClose={() => setDismissOpen(false)}
        title="Dismiss this alert"
        primaryAction={{ content: "Dismiss", onAction: () => setStatus("dismissed", "dismiss"), loading: busy === "dismiss" }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDismissOpen(false) }]}
      >
        <Modal.Section>
          <div className="sr-stack">
            <p className="sr-body">Tell Shop Rules why. Your reason becomes a standing instruction so the same alert does not come back.</p>
            <TextField label="Reason" value={reason} onChange={setReason} multiline={3} autoComplete="off" placeholder="We already hold a CPC for this item, tested in March." />
          </div>
        </Modal.Section>
      </Modal>
    </div>
  );
}
