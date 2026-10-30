// Pure margin math shared by the pages. Inputs are the listing price, the
// seller's landed-cost share of price, a duty change in percentage points,
// and the units sold per week. Everything is an estimate the seller can tune
// in Settings; the UI labels it as such. All math lives in pricing.ts.
import { pricingInputs, reprice, type PricingResult } from "./pricing";

export interface Economics {
  price: number;
  landed_cost: number;
  margin_pct: number;
  duty_delta_pct: number | null;
  new_landed_cost: number | null;
  new_margin_pct: number | null;
  margin_shift_pct: number | null;
  unit_cost_delta: number | null;
  weekly_drag: number | null;
  suggested_price: number | null;
  retail_delta: number | null;
  preserved_margin_pct: number | null;
  /** The deterministic result everything above was derived from. */
  pricing: PricingResult | null;
}

export function computeEconomics(input: {
  price: number | null;
  unit_cost?: number | null;
  unit_cost_pct?: number;
  dutiable_share?: number | null;
  duty_delta_pct?: number | null;
  est_cost_change_pct?: number | null;
  units_per_week?: number;
  target_margin_pct?: number;
}): Economics | null {
  const inputs = pricingInputs(
    { price: input.price, unit_cost: input.unit_cost ?? null, dutiable_share: input.dutiable_share ?? null },
    { tariff_rate_change_pct: input.duty_delta_pct ?? null, estimated_cost_change_pct: input.est_cost_change_pct ?? null },
    { unit_cost_pct: input.unit_cost_pct, units_per_week: input.units_per_week, target_margin_pct: input.target_margin_pct },
  );
  if (!inputs) return null;
  return economicsFromPricing(inputs.price, reprice(inputs));
}

/** Adapts a stored PricingResult to the Economics shape the pages render. */
export function economicsFromPricing(price: number, p: PricingResult | null): Economics | null {
  if (!p || !Number.isFinite(price) || price <= 0) return null;
  const changed = p.basis !== "none" && p.cost_delta !== 0;
  return {
    price,
    landed_cost: p.old_cost,
    margin_pct: p.old_margin_pct,
    duty_delta_pct: null,
    new_landed_cost: changed ? p.new_cost : null,
    new_margin_pct: changed ? p.new_margin_pct_if_unchanged : null,
    margin_shift_pct: changed ? p.new_margin_pct_if_unchanged - p.old_margin_pct : null,
    unit_cost_delta: changed ? p.cost_delta : null,
    weekly_drag: changed ? p.weekly_drag : null,
    suggested_price: p.suggested_price,
    retail_delta: p.suggested_delta,
    preserved_margin_pct: p.suggested_price != null ? p.margin_at_suggested_pct : null,
    pricing: p,
  };
}

export function fmtMoney(v: number | null | undefined, currency = "USD", digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
  } catch {
    return `$${v.toFixed(digits)}`;
  }
}

export function fmtCompact(v: number): string {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

export function fmtPct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const s = `${v.toFixed(digits)}%`;
  return signed && v > 0 ? `+${s}` : s;
}
