// Pure margin math shared by the pages. Inputs are the listing price, the
// seller's landed-cost share of price, a duty change in percentage points,
// and the units sold per week. Everything is an estimate the seller can tune
// in Settings; the UI labels it as such.

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
}

export function computeEconomics(input: {
  price: number | null;
  unit_cost_pct?: number;
  duty_delta_pct?: number | null;
  units_per_week?: number;
  suggested_price?: number | null;
}): Economics | null {
  const price = input.price;
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  const costShare = (input.unit_cost_pct ?? 45) / 100;
  const landed = price * costShare;
  const margin = ((price - landed) / price) * 100;
  const delta = input.duty_delta_pct ?? null;
  const units = input.units_per_week ?? 20;

  let newLanded: number | null = null;
  let newMargin: number | null = null;
  let unitDelta: number | null = null;
  let weekly: number | null = null;
  if (delta != null && Number.isFinite(delta) && delta !== 0) {
    newLanded = landed * (1 + delta / 100);
    unitDelta = newLanded - landed;
    newMargin = ((price - newLanded) / price) * 100;
    weekly = -unitDelta * units;
  }

  const suggested = input.suggested_price ?? null;
  const retailDelta = suggested != null ? suggested - price : null;
  const preserved = suggested != null && newLanded != null ? ((suggested - newLanded) / suggested) * 100 : null;

  return {
    price,
    landed_cost: landed,
    margin_pct: margin,
    duty_delta_pct: delta,
    new_landed_cost: newLanded,
    new_margin_pct: newMargin,
    margin_shift_pct: newMargin != null ? newMargin - margin : null,
    unit_cost_delta: unitDelta,
    weekly_drag: weekly,
    suggested_price: suggested,
    retail_delta: retailDelta,
    preserved_margin_pct: preserved,
  };
}

export function thresholdAmount(note: string | null | undefined): number | null {
  if (!note) return null;
  const m = note.match(/\$\s?([\d,]+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
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
