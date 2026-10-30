"use client";

import { Banner } from "@shopify/polaris";
import NextLink from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api, timeAgo, useApi } from "@/lib/client";
import type { AccountRow, AlertRow, ForgeRow, PriceRow, ProductRow, RuleRow, SkillRow } from "@/lib/db";
import { computeEconomics, fmtMoney, fmtPct } from "@/lib/economics";
import { countryName, FAMILY_LABEL } from "@/lib/rules-catalog";
import { Sparkline } from "@/components/ui";
import { ForgeListRow, ForgeStepper, useForgeStageTimer } from "@/components/forge";
import {
  AccentCard,
  alertTone,
  AuditRow,
  BackLink,
  Disclosure,
  DutyImpact,
  effectiveLabel,
  EmptyCard,
  FAMILY_SHORT,
  marketplaceLabel,
  ProductThumb,
  RepriceBlock,
  Skeleton,
  sortAlerts,
  sourceDomain,
  SrButton,
  SrCard,
  StatusPill,
  StatusStrip,
} from "@/components/stitch";

type Detail = { product: ProductRow; rules: RuleRow[]; alerts: AlertRow[]; price_history: PriceRow[]; skills: SkillRow[] };
type CheckResult = { alerts: AlertRow[]; checked: number; skipped_unchanged: number; errors: string[]; meter: { tavily_calls: number; llm: Array<{ tier: string; cost_usd: number }> } };

export default function ProductInspectorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const { data, loading, error, refresh } = useApi<Detail>(id ? `/api/products/${id}` : null);
  const account = useApi<{ account: AccountRow }>("/api/account");
  const settings = account.data?.account.settings;

  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Rule Forge: checks as code for one rule of this product.
  const forges = useApi<{ forges: ForgeRow[]; sandbox: { configured: boolean; image: string } }>(id ? `/api/forges?product_id=${id}` : null);
  const [forgeRule, setForgeRule] = useState("");
  const [forging, setForging] = useState(false);
  const [forgeSettled, setForgeSettled] = useState<ForgeRow | null>(null);
  const [forgeNotice, setForgeNotice] = useState<{ tone: "success" | "warning" | "info"; text: string; id: string } | null>(null);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const forgeStage = useForgeStageTimer(forging);

  const product = data?.product;
  const productMap = useMemo(() => new Map(product ? [[product.id, product] as const] : []), [product]);
  const openAlerts = useMemo(() => (data ? sortAlerts(data.alerts.filter((a) => a.status === "new"), productMap, settings) : []), [data, productMap, settings]);
  const top = openAlerts[0] ?? null;

  async function runCheck() {
    if (!id) return;
    setChecking(true);
    setActionError(null);
    setResult(null);
    try {
      const r = await api<CheckResult>(`/api/products/${id}/check`, { method: "POST", json: { force: false, max_rules: 4 } });
      setResult(r);
      refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  async function draftReprice() {
    if (!top || top.action?.suggested_price == null) return;
    const price = top.action.suggested_price;
    setDrafting(true);
    setActionError(null);
    try {
      try {
        await navigator.clipboard.writeText(price.toFixed(2));
      } catch {
        // Clipboard can be blocked outside a secure context; the price is still shown on screen.
      }
      await api(`/api/alerts/${top.id}`, { method: "PATCH", json: { status: "actioned" } });
      setNotice(`New price ${fmtMoney(price, currency)} copied. Paste it into your listing.`);
      refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  async function forgeCheck() {
    if (!id || !data) return;
    const ruleId = forgeRule || (data.rules.find((r) => r.family === "tariff") ?? data.rules[0])?.id;
    if (!ruleId) return;
    setForging(true);
    setForgeNotice(null);
    setForgeError(null);
    try {
      const r = await api<{ forge: ForgeRow }>(`/api/products/${id}/forge`, { method: "POST", json: { rule_id: ruleId } });
      setForgeSettled(r.forge);
      setForgeNotice({
        tone: r.forge.status === "passed" ? "success" : r.forge.status === "failed" ? "warning" : "info",
        text:
          r.forge.status === "passed"
            ? `check.py passed its tests after ${r.forge.iterations} iteration${r.forge.iterations === 1 ? "" : "s"} in ${(r.forge.duration_ms / 1000).toFixed(0)} s.`
            : r.forge.status === "failed"
              ? `The tests still fail after ${r.forge.iterations} iteration${r.forge.iterations === 1 ? "" : "s"}. The code and the failures are kept for review.`
              : "The code and tests were written; the sandbox run was skipped because no sandbox is configured.",
        id: r.forge.id,
      });
      forges.refresh();
      setTimeout(() => setForgeSettled(null), 2500);
    } catch (e) {
      setForgeError((e as Error).message);
    } finally {
      setForging(false);
    }
  }

  function exportDossier() {
    if (!data) return;
    const seen = new Set<string>();
    const sources = data.alerts.flatMap((a) => a.sources ?? []).filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
    const dossier = { exported_at: new Date().toISOString(), product: data.product, rules: data.rules, alerts: data.alerts, sources, price_history: data.price_history };
    const blob = new Blob([JSON.stringify(dossier, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shop-rules-dossier-${data.product.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice("Dossier downloaded: product, rules, alerts, and sources as JSON.");
  }

  async function remove() {
    if (!id || !confirm("Stop watching this product? Its rules and alerts are removed too.")) return;
    try {
      await api(`/api/products/${id}`, { method: "DELETE" });
      router.push("/products");
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  if (error) {
    return (
      <div className="sr-page sr-page--narrow">
        <BackLink href="/products">Inspector</BackLink>
        <Banner tone="critical">
          <p>{error}</p>
        </Banner>
      </div>
    );
  }
  if (loading || !data || !product) {
    return (
      <div className="sr-page">
        <BackLink href="/products">Inspector</BackLink>
        <Skeleton lines={2} />
        <Skeleton lines={5} />
      </div>
    );
  }

  const { rules, alerts, price_history, skills } = data;
  const profile = product.profile;
  const defaultForgeRule = rules.find((r) => r.family === "tariff") ?? rules[0] ?? null;
  const forgeList = forges.data?.forges ?? [];
  const forgePassing = forgeList.filter((f) => f.status === "passed").length;
  const currency = product.currency || settings?.currency || "USD";
  const unitCostPct = settings?.unit_cost_pct ?? 45;
  const units = settings?.units_per_week ?? 20;
  const base = computeEconomics({ price: product.price, unit_cost_pct: unitCostPct });
  const econ = top ? computeEconomics({ price: product.price, unit_cost_pct: unitCostPct, duty_delta_pct: top.impact?.tariff_rate_change_pct ?? null, units_per_week: units, suggested_price: top.action?.suggested_price ?? null }) : null;
  const hasDuty = Boolean(econ && econ.new_margin_pct != null);
  const hts = profile?.hts_candidates?.[0];
  const topTone = top ? alertTone(top) : "success";
  const topDomain = top ? sourceDomain(top) : null;

  const openByRule = new Map<string, AlertRow>();
  for (const a of openAlerts) if (!openByRule.has(a.rule_id)) openByRule.set(a.rule_id, a);
  const auditRules = rules.filter((r) => r.family === "safety" || r.family === "policy");
  const clearCount = auditRules.filter((r) => !openByRule.has(r.id) && r.last_run_at).length;
  const dueCount = rules.filter((r) => !r.last_run_at || Date.now() - new Date(r.last_run_at).getTime() > r.cadence_hours * 3600 * 1000).length;
  const families = Array.from(new Set(rules.map((r) => r.family)));
  const flags = [
    profile?.intended_for_children ? "For children" : null,
    profile?.is_cosmetic ? "Cosmetic" : null,
    profile?.is_electronic ? "Electronic" : null,
    profile?.has_battery ? "Battery" : null,
    profile?.is_textile ? "Textile" : null,
    profile?.is_food_contact ? "Food contact" : null,
    profile?.is_supplement_or_food ? "Food or supplement" : null,
  ].filter(Boolean) as string[];
  const suggestedRaw = top?.action?.suggested_price ?? null;
  const suggested = suggestedRaw != null && product.price != null && Math.abs(suggestedRaw - product.price) < 0.005 ? null : suggestedRaw;
  const llmCost = result ? result.meter.llm.reduce((s, c) => s + c.cost_usd, 0) : 0;

  return (
    <div className="sr-page">
      <BackLink href="/products">Inspector</BackLink>

      {actionError ? (
        <Banner tone="critical" onDismiss={() => setActionError(null)}>
          <p>{actionError}</p>
        </Banner>
      ) : null}
      {checking ? (
        <Banner tone="info" title="Checking official sources">
          <p>Searching each due rule on its official domains, reading the pages, and deciding whether the change touches this product. This takes 20 to 60 seconds.</p>
        </Banner>
      ) : null}
      {result ? (
        <Banner tone={result.alerts.length ? "warning" : "success"} title={result.alerts.length ? `${result.alerts.length} new alert${result.alerts.length === 1 ? "" : "s"}` : "No new alerts"} onDismiss={() => setResult(null)}>
          <p>
            Checked {result.checked} rule{result.checked === 1 ? "" : "s"}, {result.skipped_unchanged} unchanged since last run, {result.meter.tavily_calls} source reads, about ${llmCost.toFixed(4)} in model cost.
            {result.errors.length ? ` Problems: ${result.errors.join("; ")}` : ""}
          </p>
        </Banner>
      ) : null}
      {notice ? (
        <Banner tone="success" onDismiss={() => setNotice(null)}>
          <p>{notice}</p>
        </Banner>
      ) : null}

      <StatusStrip
        title={`Inspecting product, ${marketplaceLabel(product.marketplace)}`}
        subtitle={`Last check ${product.last_checked_at ? timeAgo(product.last_checked_at) : "never"}, ${rules.length} rule${rules.length === 1 ? "" : "s"} on official sources`}
        right={
          <SrButton href={product.url} external>
            Listing
          </SrButton>
        }
      />

      <div className="sr-hud">
        <div className="sr-hud__main">
          <SrCard className="sr-stack" style={{ order: 1 }}>
            <div className="sr-row sr-row--top" style={{ gap: 12 }}>
              <ProductThumb product={product} size="lg" />
              <div className="sr-grow sr-stack" style={{ gap: 4 }}>
                <div className="sr-row sr-row--wrap" style={{ gap: 6 }}>
                  <StatusPill tone="success" dot caps={false}>
                    {marketplaceLabel(product.marketplace)}
                  </StatusPill>
                  {profile?.origin_country ? <StatusPill caps={false}>From {countryName(profile.origin_country)}</StatusPill> : null}
                  {flags.slice(0, 3).map((f) => (
                    <StatusPill key={f} caps={false}>
                      {f}
                    </StatusPill>
                  ))}
                </div>
                <h1 className="sr-h2 sr-clamp2">{product.title}</h1>
                <p className="sr-sm">
                  Category: {profile?.category || "n/a"}
                  {profile?.product_type ? `, ${profile.product_type}` : ""}
                </p>
                {hts?.code ? (
                  <p className="sr-xs sr-num">
                    HS {hts.code}, {hts.description} ({Math.round(hts.confidence * 100)}% confidence)
                  </p>
                ) : null}
              </div>
            </div>
            <div className="sr-inset sr-pricegrid">
              <div>
                <p className="sr-xs">Retail price</p>
                <p className="sr-pricegrid__value" style={{ marginTop: 2 }}>
                  {fmtMoney(product.price, currency)}{" "}
                  <span className="sr-sm" style={{ fontWeight: 400 }}>
                    {currency}
                  </span>
                </p>
                <p className="sr-xs" style={{ marginTop: 2 }}>
                  From the listing
                </p>
              </div>
              <div>
                <p className="sr-xs">Landed cost (base)</p>
                <p className="sr-pricegrid__value" style={{ marginTop: 2 }}>
                  {base ? fmtMoney(base.landed_cost, currency) : "n/a"}{" "}
                  <span className="sr-sm" style={{ fontWeight: 400 }}>
                    {currency}
                  </span>
                </p>
                <p className={base ? "sr-xs sr-tone-success sr-num" : "sr-xs"} style={{ marginTop: 2, fontWeight: 600 }}>
                  {base ? `Margin ${fmtPct(base.margin_pct)}` : "No price on the listing"}
                </p>
              </div>
            </div>
            <p className="sr-xs">
              Estimate: landed cost at {unitCostPct}% of price, {units} units a week.{" "}
              <NextLink href="/settings" className="sr-link">
                Edit in Settings
              </NextLink>
            </p>
          </SrCard>

          {top ? (
            <AccentCard tone={topTone} className="sr-stack" style={{ order: 2 }}>
              <div className="sr-accent-head">
                <div className="sr-grow">
                  <h2 className="sr-h2">{top.headline}</h2>
                  <p className="sr-sm sr-num" style={{ marginTop: 4 }}>
                    {hts?.code ? `HS ${hts.code}, ` : ""}
                    {topDomain ?? FAMILY_LABEL[top.family]}
                    {effectiveLabel(top.impact?.effective_date) ? `, ${effectiveLabel(top.impact?.effective_date)}` : ""}
                  </p>
                </div>
                <StatusPill tone={topTone} dot>
                  {top.severity === "high" ? "Critical / Action needed" : "Review needed"}
                </StatusPill>
              </div>

              {hasDuty && econ ? (
                <DutyImpact econ={econ} tone={topTone} currency={currency} units={units} />
              ) : (
                <div className="sr-card sr-stack">
                  <div>
                    <p className="sr-xs">What to do</p>
                    <p className="sr-body" style={{ fontWeight: 600, marginTop: 2 }}>
                      {top.action?.title || "Review the change"}
                    </p>
                  </div>
                  {top.action?.steps?.length ? (
                    <ol className="sr-steps">
                      {top.action.steps.slice(0, 3).map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  ) : null}
                  {top.impact?.estimated_cost_change_pct ? <p className="sr-xs sr-num">Estimated cost change {fmtPct(top.impact.estimated_cost_change_pct, 1, true)}</p> : null}
                </div>
              )}

              <div className="sr-actions">
                <span className="sr-xs sr-num sr-grow">
                  {top.proposed > 0 ? `${top.backed} of ${top.proposed} claims backed by ${topDomain ?? "the official source"}` : `Read from ${topDomain ?? "the official source"}`}
                  {openAlerts.length > 1 ? `, ${openAlerts.length - 1} more open` : ""}
                </span>
                <div className="sr-actions__buttons">
                  <SrButton href={`/alerts/${top.id}`}>See evidence</SrButton>
                </div>
              </div>
            </AccentCard>
          ) : (
            <SrCard className="sr-stack" style={{ order: 2 }}>
              <div className="sr-row sr-row--between sr-row--top">
                <div className="sr-grow">
                  <h2 className="sr-h2">No open alerts</h2>
                  <p className="sr-sm" style={{ marginTop: 4 }}>
                    Last check {product.last_checked_at ? timeAgo(product.last_checked_at) : "never"}. {dueCount ? `${dueCount} rule${dueCount === 1 ? " is" : "s are"} due now.` : "Every rule is on schedule."}
                  </p>
                </div>
                <StatusPill tone="success" dot>
                  Clear
                </StatusPill>
              </div>
              <div>
                <SrButton variant="primary" onClick={runCheck} loading={checking}>
                  Run a check now
                </SrButton>
              </div>
            </SrCard>
          )}

          <SrCard style={{ order: 3 }}>
            <div className="sr-row sr-row--between" style={{ paddingBottom: 8, borderBottom: "1px solid var(--sr-border)" }}>
              <h2 className="sr-h2">Compliance audit</h2>
              <StatusPill caps={false}>
                {clearCount} of {auditRules.length} clear
              </StatusPill>
            </div>
            {auditRules.length === 0 ? (
              <p className="sr-sm" style={{ paddingTop: 10 }}>
                No safety or marketplace rules apply to this product.
              </p>
            ) : (
              <div className="sr-rows">
                {auditRules.map((r) => {
                  const a = openByRule.get(r.id);
                  const state = a ? "action" : r.last_run_at ? "clear" : "pending";
                  return (
                    <AuditRow key={r.id} title={r.title} state={state} sub={a ? `Open alert ${timeAgo(a.created_at)}, ${sourceDomain(a) ?? r.include_domains[0]}` : r.last_run_at ? `Checked ${timeAgo(r.last_run_at)}, ${r.include_domains[0]}` : r.include_domains.join(", ")}>
                      {a ? (
                        <p style={{ margin: 0, color: "var(--sr-text)" }}>
                          {a === top ? "Shown above. " : ""}
                          {a.action?.title}
                        </p>
                      ) : null}
                      {r.seed_note ? <p style={{ margin: 0 }}>{r.seed_note}</p> : null}
                      {r.last_headline ? <p style={{ margin: 0 }}>Last finding: {r.last_headline}</p> : null}
                      <p style={{ margin: 0 }}>
                        Sources: {r.include_domains.join(", ")}. Checked every {r.cadence_hours} h.
                      </p>
                      {a ? (
                        <NextLink href={`/alerts/${a.id}`} className="sr-link">
                          Open alert
                        </NextLink>
                      ) : null}
                    </AuditRow>
                  );
                })}
              </div>
            )}
          </SrCard>

          <SrCard className="sr-stack" style={{ order: 5 }}>
            <div className="sr-row sr-row--between">
              <h2 className="sr-h2">Checks as code</h2>
              {forges.data ? (
                <StatusPill caps={false} tone={forgeList.length && forgePassing === forgeList.length ? "success" : "neutral"}>
                  {forgeList.length ? `${forgePassing} of ${forgeList.length} passing` : "None yet"}
                </StatusPill>
              ) : null}
            </div>
            <p className="sr-sm">Rule Forge writes a deterministic check for a rule, runs it in a Token Factory sandbox, and keeps it when the tests pass.</p>
            {forges.data && !forges.data.sandbox.configured ? <p className="sr-xs">Sandbox not configured on this server: the code and tests are still written, the run is skipped.</p> : null}
            <div className="sr-forge-form">
              <label className="sr-stack" style={{ gap: 4 }}>
                <span className="sr-xs" style={{ fontWeight: 500 }}>
                  Rule
                </span>
                <select className="sr-select" value={forgeRule || defaultForgeRule?.id || ""} onChange={(e) => setForgeRule(e.target.value)} disabled={forging || rules.length === 0}>
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {FAMILY_SHORT[r.family] ?? r.family}: {r.title}
                    </option>
                  ))}
                </select>
              </label>
              <SrButton variant="primary" size="lg" onClick={forgeCheck} loading={forging} disabled={rules.length === 0}>
                Forge a check
              </SrButton>
            </div>
            {forging ? <ForgeStepper stage={forgeStage} /> : forgeSettled ? <ForgeStepper settled={forgeSettled} /> : null}
            {forgeError ? (
              <Banner tone="critical" title="The forge could not finish" onDismiss={() => setForgeError(null)}>
                <p>{forgeError}</p>
              </Banner>
            ) : null}
            {forgeNotice ? (
              <Banner tone={forgeNotice.tone} onDismiss={() => setForgeNotice(null)}>
                <p>
                  {forgeNotice.text}{" "}
                  <NextLink href={`/forge/${forgeNotice.id}`} className="sr-link">
                    Open the check
                  </NextLink>
                </p>
              </Banner>
            ) : null}
            {forges.loading ? (
              <Skeleton lines={2} card={false} />
            ) : forgeList.length === 0 ? (
              <p className="sr-xs">No checks yet. Forge one for the tariff rule to watch the agent write, test, and run it.</p>
            ) : (
              <div className="sr-rows">
                {forgeList.map((f) => (
                  <ForgeListRow key={f.id} forge={f} />
                ))}
              </div>
            )}
          </SrCard>

          <div style={{ order: 6 }}>
            <Disclosure title={`All watch rules (${rules.length})`}>
              {rules.length === 0 ? (
                <p className="sr-sm">No rules yet.</p>
              ) : (
                <div className="sr-stack">
                  {families.map((f) => (
                    <div key={f} className="sr-stack sr-stack--tight">
                      <p className="sr-xs" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
                        {FAMILY_LABEL[f]}
                      </p>
                      <div className="sr-rows">
                        {rules
                          .filter((r) => r.family === f)
                          .map((r) => (
                            <div key={r.id} style={{ padding: "8px 0" }}>
                              <div className="sr-row sr-row--between" style={{ gap: 8 }}>
                                <span className="sr-body" style={{ fontWeight: 600 }}>
                                  {r.title}
                                </span>
                                {openByRule.has(r.id) ? <StatusPill tone="critical">Open</StatusPill> : r.last_run_at ? <StatusPill tone="success">Clear</StatusPill> : <StatusPill>Queued</StatusPill>}
                              </div>
                              <p className="sr-xs sr-num" style={{ marginTop: 2 }}>
                                Every {r.cadence_hours} h, last run {timeAgo(r.last_run_at)}. {r.include_domains.join(", ")}
                              </p>
                              {r.seed_note ? (
                                <p className="sr-xs" style={{ marginTop: 2, color: "var(--sr-text)" }}>
                                  {r.seed_note}
                                </p>
                              ) : null}
                              {r.last_headline ? (
                                <p className="sr-xs" style={{ marginTop: 2 }}>
                                  Last finding: {r.last_headline}
                                </p>
                              ) : null}
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Disclosure>
          </div>
        </div>

        <div className="sr-hud__aside">
          <SrCard className="sr-stack" style={{ order: 4 }}>
            {top && suggested != null ? (
              <RepriceBlock
                price={suggested}
                currency={currency}
                preservedPct={econ?.preserved_margin_pct ?? null}
                retailDelta={econ?.retail_delta ?? (product.price != null ? suggested - product.price : null)}
                onDraft={draftReprice}
                busy={drafting}
              />
            ) : null}
            <div className="sr-grid-2 sr-grid-2--always sr-grid-2--tight">
              <SrButton size="lg" onClick={runCheck} loading={checking}>
                Run check now
              </SrButton>
              <SrButton size="lg" onClick={exportDossier}>
                Export dossier
              </SrButton>
            </div>
            <p className="sr-xs" style={{ textAlign: "center" }}>
              {top && suggested != null ? "Drafting copies the price and marks the alert done." : dueCount ? `${dueCount} rule${dueCount === 1 ? "" : "s"} due. A check takes 20 to 60 seconds.` : "A check reads each official source again and quotes what changed."}
            </p>
          </SrCard>

          <SrCard className="sr-stack" style={{ order: 7 }}>
            <h2 className="sr-h2">Price history</h2>
            <Sparkline points={price_history.map((p) => ({ at: p.at, price: Number(p.price) }))} markers={alerts.map((a) => a.created_at)} />
            <p className="sr-xs">Red lines mark alerts. Points come from the listing, the extension, and checks.</p>
          </SrCard>

          <SrCard className="sr-stack" style={{ order: 8 }}>
            <h2 className="sr-h2">Standing instructions</h2>
            {skills.length === 0 ? (
              <p className="sr-sm">Dismiss an alert with a reason and Shop Rules writes it down here, then follows it on future checks.</p>
            ) : (
              <div className="sr-rows">
                {skills.map((s) => (
                  <div key={s.id} className="sr-kv">
                    <span>{s.scope}</span>
                    <span style={{ textAlign: "left", color: "var(--sr-text)" }}>{s.text}</span>
                  </div>
                ))}
              </div>
            )}
          </SrCard>

          <div style={{ order: 9, textAlign: "center" }}>
            <SrButton variant="plain" className="sr-link--danger" onClick={remove}>
              Stop watching this product
            </SrButton>
          </div>
        </div>
      </div>
      {alerts.length === 0 && rules.length === 0 ? <EmptyCard title="No rules seeded" text="This product has no watch rules. Remove it and add the listing again." /> : null}
    </div>
  );
}
