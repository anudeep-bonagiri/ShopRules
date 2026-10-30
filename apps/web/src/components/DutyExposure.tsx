"use client";

import NextLink from "next/link";
import type { AccountRow, ProductRow } from "@/lib/db";
import { dutyExposure, dutyPerUnit, stackedRateLabel, type DutyLayer } from "@/lib/duty-exposure";
import { fmtMoney, fmtPct } from "@/lib/economics";
import { effectivePrice, effectiveProfile, pricingProduct } from "@/lib/product";
import { DEFAULT_DUTIABLE_SHARE, landedCostFor, pricingInputs, reprice } from "@/lib/pricing";
import { countryName } from "@/lib/rules-catalog";
import { signedMoney, StatusPill, type Tone } from "@/components/stitch";

type Settings = AccountRow["settings"] | undefined;

// Duty exposure from data already on the product: the general rate read from
// hts.usitc.gov, the Section 301 seed for the heading, and the origin surcharge
// the seller set. Each layer says where its number came from. The reprice at
// the bottom is the same deterministic math an alert uses (pricing.ts), fed the
// layers beyond the general rate.

const LAYER_TONE: Record<DutyLayer["status"], Tone> = { read: "success", seed: "warning", set: "info", none: "neutral", unknown: "neutral" };
const LAYER_WORD: Record<DutyLayer["status"], string> = { read: "read", seed: "seed", set: "set by you", none: "none", unknown: "not set" };

function rateText(l: DutyLayer): string {
  if (l.rate_pct == null) return "?";
  if (l.rate_pct === 0) return l.status === "none" ? "0%" : "Free";
  return `${Number.isInteger(l.rate_pct) ? l.rate_pct : l.rate_pct.toFixed(1)}%`;
}

export function DutyExposureCard({ product, settings }: { product: ProductRow; settings: Settings }) {
  const profile = effectiveProfile(product);
  const heading = profile.hts_candidates?.[0]?.code ?? null;
  const exposure = dutyExposure({ origin_country: profile.origin_country, heading, duty_rate: product.duty_rate ?? null, surcharge_pct: product.overrides?.duty_surcharge_pct ?? null });
  const currency = product.currency || settings?.currency || "USD";
  const pp = pricingProduct(product);
  const price = effectivePrice(product);
  const landed = landedCostFor(pp, settings);
  const share = pp.dutiable_share ?? settings?.dutiable_share ?? DEFAULT_DUTIABLE_SHARE;
  const perUnit = landed != null ? dutyPerUnit(exposure, landed, share) : null;
  const inputs = exposure.additional_pts > 0 ? pricingInputs(pp, { tariff_rate_change_pct: exposure.additional_pts, estimated_cost_change_pct: null }, settings) : null;
  const result = inputs ? reprice(inputs) : null;
  const label = stackedRateLabel(exposure);

  return (
    <div className="sr-stack">
      <div className="sr-row sr-row--between sr-row--top" style={{ gap: 12 }}>
        <div className="sr-grow">
          <h2 className="sr-h2">Duty exposure</h2>
          <p className="sr-sm" style={{ marginTop: 4 }}>
            {exposure.domestic ? `Made in the United States, so nothing is owed at the border.` : `Stacked rate on the customs value of each unit${profile.origin_country ? `, origin ${countryName(profile.origin_country)}` : ", origin unknown"}${heading ? `, heading ${heading}` : ""}.`}
          </p>
        </div>
        <div className="sr-right">
          <p className="sr-pricegrid__value sr-num" style={{ margin: 0 }}>
            {label}
          </p>
          <p className="sr-xs sr-num" style={{ marginTop: 2 }}>
            {perUnit != null && !exposure.domestic ? `${fmtMoney(perUnit, currency)} duty in each unit` : exposure.domestic ? "no import duty" : "no price yet"}
          </p>
        </div>
      </div>

      <div className="sr-rows">
        {exposure.layers.map((l) => (
          <div key={l.key} className="sr-row sr-row--top" style={{ gap: 10, padding: "8px 0", borderTop: "1px solid var(--sr-border)" }}>
            <span className="sr-num" style={{ minWidth: 52, fontWeight: 700 }}>
              {rateText(l)}
            </span>
            <div className="sr-grow sr-stack" style={{ gap: 2 }}>
              <div className="sr-row sr-row--wrap" style={{ gap: 6 }}>
                <span className="sr-body" style={{ fontWeight: 600 }}>
                  {l.label}
                </span>
                <StatusPill tone={LAYER_TONE[l.status]} caps={false}>
                  {LAYER_WORD[l.status]}
                </StatusPill>
                {l.as_of ? <span className="sr-xs sr-num">as of {l.as_of}</span> : null}
              </div>
              <p className="sr-xs" style={{ margin: 0 }}>
                {l.note}{" "}
                {l.url ? (
                  <a className="sr-link" href={l.url} target="_blank" rel="noopener noreferrer">
                    {l.source}
                  </a>
                ) : null}
              </p>
            </div>
          </div>
        ))}
      </div>

      {exposure.domestic ? null : exposure.additional_pts > 0 && result && price != null && landed != null ? (
        <div className="sr-inset sr-stack" style={{ gap: 6 }}>
          <div className="sr-row sr-row--between sr-row--wrap" style={{ gap: 8 }}>
            <div>
              <p className="sr-xs">If your landed cost is before these duties</p>
              <p className="sr-body" style={{ fontWeight: 700, marginTop: 2 }}>
                {result.suggested_price != null ? `Hold your margin at ${fmtMoney(result.suggested_price, currency)}` : "The price can hold"}
                {result.suggested_delta != null ? <span className="sr-sm sr-num" style={{ fontWeight: 400 }}>{` (${signedMoney(result.suggested_delta, currency)})`}</span> : null}
              </p>
            </div>
            <p className="sr-xs sr-num sr-right">
              +{exposure.additional_pts} pts beyond the general rate
              <br />
              {signedMoney(result.cost_delta, currency)} per unit, {fmtPct(result.old_margin_pct)} to {fmtPct(result.new_margin_pct_if_unchanged)} margin unchanged
            </p>
          </div>
          <p className="sr-xs">{result.explanation} Seed and set layers are inputs you confirm, not findings from a source.</p>
        </div>
      ) : exposure.unknown.length ? (
        <p className="sr-xs">
          {exposure.unknown.includes("origin") ? "Set the origin surcharge under Your numbers to complete the stack. " : ""}
          {exposure.unknown.includes("general") ? "The general rate is read from hts.usitc.gov when the heading is set. " : ""}
          <NextLink href="/settings" className="sr-link">
            Workspace defaults
          </NextLink>
        </p>
      ) : null}
    </div>
  );
}
