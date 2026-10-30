// Deterministic reprice math. Pure, no I/O, no model output. Every dollar or
// percent the UI shows for a reprice comes from here, and the same file is
// bundled into the extension (see extension/build.mjs) so both surfaces agree.
//
// Duty applies to the customs value of a unit, not to freight or handling, so a
// duty change is scaled by `dutiable_share` of the landed cost (default 0.85).

export type PricingInputs = {
  price: number; // current retail
  landed_cost: number; // per unit, delivered
  dutiable_share: number; // 0..1, share of landed cost that is customs value; default 0.85
  duty_rate_change_pts: number | null; // percentage points, from the alert
  est_cost_change_pct: number | null; // fallback when no duty rate
  units_per_week: number;
  target_margin_pct: number; // floor the seller wants to protect
  rounding: 0.5 | 0.99 | 0.01; // default 0.5
};

export type PricingStrategy = "hold_margin" | "hold_target" | "absorb";

export type PricingResult = {
  old_cost: number;
  new_cost: number;
  cost_delta: number;
  old_margin_pct: number;
  new_margin_pct_if_unchanged: number;
  weekly_drag: number; // negative number when cost rises
  strategy: PricingStrategy;
  suggested_price: number | null; // null when strategy is absorb
  suggested_delta: number | null;
  /** Margin at the suggested price, or at the current price when absorbing. */
  margin_at_suggested_pct: number;
  /** What drove the cost change. */
  basis: "duty" | "cost" | "none";
  explanation: string; // one plain sentence, no em dashes
};

export const DEFAULT_DUTIABLE_SHARE = 0.85;
export const DEFAULT_UNIT_COST_PCT = 45;
export const DEFAULT_UNITS_PER_WEEK = 20;
export const DEFAULT_TARGET_MARGIN_PCT = 35;
export const DEFAULT_ROUNDING: PricingInputs["rounding"] = 0.5;

const cents = (v: number): number => Math.round(v * 100) / 100;

export function roundPrice(v: number, step: PricingInputs["rounding"]): number {
  if (step === 0.99) return cents(Math.max(0, Math.round(v - 0.99)) + 0.99);
  return cents(Math.round(v / step) * step);
}

function roundPriceUp(v: number, step: PricingInputs["rounding"]): number {
  if (step === 0.99) return cents(Math.max(0, Math.ceil(v - 0.99)) + 0.99);
  return cents(Math.ceil(v / step - 1e-9) * step);
}

function marginPct(price: number, cost: number): number {
  return price > 0 ? ((price - cost) / price) * 100 : 0;
}

function money(v: number): string {
  return `$${Math.abs(v).toFixed(2)}`;
}

function pct(v: number): string {
  return `${Math.round(v)}%`;
}

function pts(v: number): string {
  const s = Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(1).replace(/\.0$/, "");
  return `${s} point${Math.abs(v) === 1 ? "" : "s"}`;
}

export function reprice(i: PricingInputs): PricingResult {
  const price = Number.isFinite(i.price) && i.price > 0 ? i.price : 0;
  const landed = Number.isFinite(i.landed_cost) && i.landed_cost >= 0 ? i.landed_cost : 0;
  const share = Number.isFinite(i.dutiable_share) ? Math.min(Math.max(i.dutiable_share, 0), 1) : DEFAULT_DUTIABLE_SHARE;
  const units = Number.isFinite(i.units_per_week) && i.units_per_week >= 0 ? i.units_per_week : DEFAULT_UNITS_PER_WEEK;
  const target = Number.isFinite(i.target_margin_pct) ? i.target_margin_pct : DEFAULT_TARGET_MARGIN_PCT;
  const rounding = i.rounding ?? DEFAULT_ROUNDING;

  let basis: PricingResult["basis"] = "none";
  let costDelta = 0;
  const duty = i.duty_rate_change_pts;
  const est = i.est_cost_change_pct;
  if (typeof duty === "number" && Number.isFinite(duty) && duty !== 0) {
    basis = "duty";
    costDelta = landed * share * (duty / 100);
  } else if (typeof est === "number" && Number.isFinite(est) && est !== 0) {
    basis = "cost";
    costDelta = landed * (est / 100);
  }


  const newCost = landed + costDelta;
  const oldMargin = marginPct(price, landed);
  const newMarginUnchanged = marginPct(price, newCost);
  const weeklyDrag = cents(-costDelta * units);

  const driver = basis === "duty" ? `Duty ${duty! > 0 ? "up" : "down"} ${pts(duty!)}` : basis === "cost" ? `Landed cost ${est! > 0 ? "up" : "down"} ${Math.abs(est!).toFixed(1).replace(/\.0$/, "")}%` : "";

  const absorb = (explanation: string): PricingResult => ({
    old_cost: landed,
    new_cost: newCost,
    cost_delta: costDelta,
    old_margin_pct: oldMargin,
    new_margin_pct_if_unchanged: newMarginUnchanged,
    weekly_drag: weeklyDrag,
    strategy: "absorb",
    suggested_price: null,
    suggested_delta: null,
    margin_at_suggested_pct: newMarginUnchanged,
    basis,
    explanation,
  });

  if (price <= 0) return absorb("No listing price is known, so there is nothing to reprice yet.");
  if (basis === "none" || Math.abs(costDelta) < 0.0005) return absorb("This alert does not change the unit cost, so the price can hold.");
  if (costDelta < 0) {
    return absorb(`${driver} saves ${money(costDelta)} on each unit, so margin rises to ${pct(newMarginUnchanged)} at the current price.`);
  }

  // Cost went up. Decide which margin to protect.
  const belowTarget = oldMargin < target;
  const strategy: PricingStrategy = belowTarget ? "hold_target" : "hold_margin";
  const keep = belowTarget ? target : oldMargin;
  const raw = keep >= 100 ? price + costDelta : newCost / (1 - keep / 100);
  let suggested = roundPrice(raw, rounding);
  // A positive cost change must never produce a price below the current one.
  if (suggested < price) suggested = Math.max(roundPriceUp(price, rounding), price);
  const delta = cents(suggested - price);

  // Small moves on a still healthy margin are not worth a relist.
  const threshold = Math.max(0.5, price * 0.01);
  if (newMarginUnchanged >= target && Math.abs(delta) < threshold) {
    return absorb(`${driver} adds ${money(costDelta)} to each unit, but margin stays at ${pct(newMarginUnchanged)}, above your ${pct(target)} target, so the price can hold.`);
  }

  const marginAt = marginPct(suggested, newCost);
  const explanation = belowTarget
    ? `${driver} adds ${money(costDelta)} to each unit and margin is already under your ${pct(target)} target, so ${money(suggested)} brings it back to ${pct(marginAt)}.`
    : `${driver} adds ${money(costDelta)} to each unit, so ${money(suggested)} keeps your current ${pct(oldMargin)} margin.`;

  return {
    old_cost: landed,
    new_cost: newCost,
    cost_delta: costDelta,
    old_margin_pct: oldMargin,
    new_margin_pct_if_unchanged: newMarginUnchanged,
    weekly_drag: weeklyDrag,
    strategy,
    suggested_price: suggested,
    suggested_delta: delta,
    margin_at_suggested_pct: marginAt,
    basis,
    explanation,
  };
}

// Helpers that build inputs from the shapes the app stores. Still pure.

export type PricingSettings = {
  unit_cost_pct?: number | null;
  units_per_week?: number | null;
  target_margin_pct?: number | null;
  dutiable_share?: number | null;
  rounding?: PricingInputs["rounding"] | null;
};

export type PricingProductLike = {
  price: number | null | undefined;
  /** Seller-entered landed cost per unit; wins over the workspace percent when set. */
  unit_cost?: number | null;
  dutiable_share?: number | null;
  units_per_week?: number | null;
};

export type PricingImpactLike = {
  tariff_rate_change_pct?: number | null;
  estimated_cost_change_pct?: number | null;
};

/** Landed cost per unit: the product's own figure when set, else the workspace share of price. */
export function landedCostFor(product: PricingProductLike, settings?: PricingSettings | null): number | null {
  const price = product.price;
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  if (product.unit_cost != null && Number.isFinite(product.unit_cost) && product.unit_cost >= 0) return product.unit_cost;
  const share = settings?.unit_cost_pct ?? DEFAULT_UNIT_COST_PCT;
  return price * (Math.min(Math.max(share, 0), 99) / 100);
}

export function pricingInputs(product: PricingProductLike, impact: PricingImpactLike | null | undefined, settings?: PricingSettings | null): PricingInputs | null {
  const landed = landedCostFor(product, settings);
  const price = product.price;
  if (landed == null || price == null) return null;
  return {
    price,
    landed_cost: landed,
    dutiable_share: product.dutiable_share ?? settings?.dutiable_share ?? DEFAULT_DUTIABLE_SHARE,
    duty_rate_change_pts: impact?.tariff_rate_change_pct ?? null,
    est_cost_change_pct: impact?.estimated_cost_change_pct ?? null,
    units_per_week: product.units_per_week ?? settings?.units_per_week ?? DEFAULT_UNITS_PER_WEEK,
    target_margin_pct: settings?.target_margin_pct ?? DEFAULT_TARGET_MARGIN_PCT,
    rounding: settings?.rounding ?? DEFAULT_ROUNDING,
  };
}

/** Convenience: stored result on the alert when present, else recompute from the facts. */
export function pricingForAlert(
  alert: { pricing?: PricingResult | null; impact?: PricingImpactLike | null } | null | undefined,
  product: PricingProductLike | null | undefined,
  settings?: PricingSettings | null,
): PricingResult | null {
  if (!alert) return null;
  if (alert.pricing) return alert.pricing;
  if (!product) return null;
  const inputs = pricingInputs(product, alert.impact, settings);
  return inputs ? reprice(inputs) : null;
}
