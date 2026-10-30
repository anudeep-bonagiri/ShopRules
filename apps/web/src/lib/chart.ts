// Pure geometry and formatting for the price history chart. Shared by the web
// PriceChart component (React) and the extension HUD (string-template SVG), so
// both surfaces draw the same picture from the same numbers. No DOM, no I/O.
//
// Marks follow one fixed spec: a 2px line, a 10 percent area wash, hairline solid
// gridlines, an end marker of at least 8px with a 2px surface ring, selective
// labels (latest, low, high) and a crosshair tooltip supplied by the caller.

export type ChartRange = "1W" | "1M" | "3M" | "ALL";
export const CHART_RANGES: ChartRange[] = ["1W", "1M", "3M", "ALL"];

export interface ChartPoint {
  /** epoch ms */
  t: number;
  /** price */
  v: number;
  source?: string;
}

export interface ChartMarker {
  t: number;
  kind: "alert" | "reprice" | "price";
  label: string;
}

export interface XY {
  x: number;
  y: number;
  t: number;
  v: number;
  source?: string;
}

export interface ChartLayout {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  pts: XY[];
  /** "M.. L.." polyline of the series, empty when fewer than 2 points. */
  path: string;
  /** Closed path from the line down to the plot bottom, for the 10 percent wash. */
  areaPath: string;
  yTicks: Array<{ v: number; y: number; label: string }>;
  xTicks: Array<{ t: number; x: number; label: string }>;
  markers: Array<ChartMarker & { x: number }>;
  min: XY | null;
  max: XY | null;
  first: XY | null;
  last: XY | null;
  domain: { t0: number; t1: number; v0: number; v1: number };
  x: (t: number) => number;
  y: (v: number) => number;
}

const DAY = 86_400_000;
const RANGE_MS: Record<ChartRange, number | null> = { "1W": 7 * DAY, "1M": 30 * DAY, "3M": 91 * DAY, ALL: null };

export function toChartPoints(rows: Array<{ at: string; price: number | string; source?: string }>): ChartPoint[] {
  return rows
    .map((r) => ({ t: Date.parse(r.at), v: Number(r.price), source: r.source }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
}

/** Points inside the range, plus the last point before it so the line enters from the left edge. */
export function filterRange(points: ChartPoint[], range: ChartRange, now = Date.now()): ChartPoint[] {
  const span = RANGE_MS[range];
  if (span === null) return points;
  const from = now - span;
  const inside = points.filter((p) => p.t >= from);
  const before = points.filter((p) => p.t < from);
  const prev = before[before.length - 1];
  const carry: ChartPoint[] = prev ? [{ t: from, v: prev.v, source: prev.source }] : [];
  return [...carry, ...inside];
}

/** Which ranges actually contain more than one distinct day of data; the UI disables the rest. */
export function availableRanges(points: ChartPoint[], now = Date.now()): ChartRange[] {
  if (points.length < 2) return ["ALL"];
  const first = points[0]!.t;
  return CHART_RANGES.filter((r) => {
    const span = RANGE_MS[r];
    return span === null || now - first > span / 7;
  });
}

/** Clean tick values spanning [min, max]: 1, 2, 2.5, 5 steps. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max - min < 1e-9) {
    const pad = Math.max(Math.abs(min) * 0.02, 0.5);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(count, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5 && out.length < 12; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Day or week aligned time ticks. */
export function timeTicks(t0: number, t1: number, count = 4): number[] {
  if (!(t1 > t0)) return [t0];
  const span = t1 - t0;
  const stepDays = span <= 2 * DAY ? 0.25 : span <= 10 * DAY ? 1 : span <= 45 * DAY ? 7 : span <= 200 * DAY ? 30 : 90;
  const step = stepDays * DAY;
  const out: number[] = [];
  const startDay = new Date(t0);
  startDay.setUTCHours(0, 0, 0, 0);
  let t = startDay.getTime();
  while (t < t0) t += step;
  for (; t <= t1 && out.length < 10; t += step) out.push(t);
  if (out.length < 2) return [t0, t1];
  return out.length > count * 2 ? out.filter((_, i) => i % Math.ceil(out.length / count) === 0) : out;
}

export function fmtMoneyShort(v: number, currency = "USD"): string {
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  } catch {
    return `$${v.toFixed(digits)}`;
  }
}

export function fmtMoneyFull(v: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

export function fmtDateShort(t: number, withYear = false): string {
  const d = new Date(t);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return withYear ? `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : `${month} ${d.getUTCDate()}`;
}

export function fmtDateTime(t: number): string {
  const d = new Date(t);
  return `${fmtDateShort(t, true)}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export interface DeltaSummary {
  abs: number;
  pct: number;
  direction: "up" | "down" | "flat";
}

/** Change from the first to the last point of the (already range-filtered) series. */
export function deltaSummary(points: ChartPoint[]): DeltaSummary | null {
  if (points.length < 2) return null;
  const a = points[0]!.v;
  const b = points[points.length - 1]!.v;
  const abs = Math.round((b - a) * 100) / 100;
  const pct = a > 0 ? ((b - a) / a) * 100 : 0;
  return { abs, pct, direction: Math.abs(abs) < 0.005 ? "flat" : abs > 0 ? "up" : "down" };
}

export function fmtDelta(d: DeltaSummary | null, currency = "USD"): string {
  if (!d) return "";
  if (d.direction === "flat") return "Unchanged";
  const sign = d.direction === "up" ? "+" : "-";
  return `${sign}${fmtMoneyFull(Math.abs(d.abs), currency)} (${sign}${Math.abs(d.pct).toFixed(1)}%)`;
}

export function layoutPriceChart(opts: {
  points: ChartPoint[];
  markers?: ChartMarker[];
  width: number;
  height: number;
  /** Space for axis labels. */
  padding?: { left: number; right: number; top: number; bottom: number };
  yTickCount?: number;
  xTickCount?: number;
  currency?: string;
}): ChartLayout {
  const { width, height } = opts;
  const pad = opts.padding ?? { left: 44, right: 12, top: 10, bottom: 22 };
  const plot = { left: pad.left, right: width - pad.right, top: pad.top, bottom: height - pad.bottom };
  const points = [...opts.points].sort((a, b) => a.t - b.t);
  const currency = opts.currency ?? "USD";

  const vs = points.map((p) => p.v);
  const ts = points.map((p) => p.t);
  const vMin = vs.length ? Math.min(...vs) : 0;
  const vMax = vs.length ? Math.max(...vs) : 1;
  const yTickVals = niceTicks(vMin, vMax, opts.yTickCount ?? 4);
  const v0 = yTickVals.length ? Math.min(yTickVals[0]!, vMin) : vMin;
  const v1 = yTickVals.length ? Math.max(yTickVals[yTickVals.length - 1]!, vMax) : vMax;
  const t0 = ts.length ? Math.min(...ts) : Date.now() - DAY;
  const t1raw = ts.length ? Math.max(...ts) : Date.now();
  const t1 = t1raw > t0 ? t1raw : t0 + DAY;

  const x = (t: number) => plot.left + ((t - t0) / (t1 - t0)) * (plot.right - plot.left);
  const y = (v: number) => plot.bottom - ((v - v0) / (v1 - v0 || 1)) * (plot.bottom - plot.top);

  const pts: XY[] = points.map((p) => ({ x: round1(x(p.t)), y: round1(y(p.v)), t: p.t, v: p.v, source: p.source }));
  const path = pts.length >= 2 ? pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ") : "";
  const areaPath = pts.length >= 2 ? `${path} L${pts[pts.length - 1]!.x} ${round1(plot.bottom)} L${pts[0]!.x} ${round1(plot.bottom)} Z` : "";

  const yTicks = yTickVals.map((v) => ({ v, y: round1(y(v)), label: fmtMoneyShort(v, currency) }));
  const withYear = t1 - t0 > 300 * DAY;
  const xTicks = timeTicks(t0, t1, opts.xTickCount ?? 4).map((t) => ({ t, x: round1(x(t)), label: fmtDateShort(t, withYear) }));

  const markers = (opts.markers ?? [])
    .filter((m) => Number.isFinite(m.t) && m.t >= t0 && m.t <= t1)
    .map((m) => ({ ...m, x: round1(x(m.t)) }));

  let min: XY | null = null;
  let max: XY | null = null;
  for (const p of pts) {
    if (!min || p.v < min.v) min = p;
    if (!max || p.v > max.v) max = p;
  }
  return {
    width,
    height,
    plot,
    pts,
    path,
    areaPath,
    yTicks,
    xTicks,
    markers,
    min,
    max,
    first: pts[0] ?? null,
    last: pts[pts.length - 1] ?? null,
    domain: { t0, t1, v0, v1 },
    x,
    y,
  };
}

/** Index of the point nearest to a plot x coordinate (the crosshair snaps here). */
export function nearestIndex(pts: XY[], px: number): number {
  if (pts.length === 0) return -1;
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(pts[i]!.x - px);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

/** One sentence for role="img" readers. */
export function describeSeries(points: ChartPoint[], currency = "USD"): string {
  if (points.length === 0) return "No price points yet.";
  const only = points[0]!;
  if (points.length === 1) return `One price point: ${fmtMoneyFull(only.v, currency)} on ${fmtDateShort(only.t, true)}.`;
  const d = deltaSummary(points);
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const lastPt = points[points.length - 1]!;
  return `Price history, ${points.length} points from ${fmtDateShort(only.t, true)} to ${fmtDateShort(lastPt.t, true)}. Latest ${fmtMoneyFull(lastPt.v, currency)}, ${d ? fmtDelta(d, currency).toLowerCase() : ""} over the period, low ${fmtMoneyFull(lo, currency)}, high ${fmtMoneyFull(hi, currency)}.`;
}

/** Compact sparkline geometry for stat tiles: no axes, 12 to 30 points, fixed box. */
export function sparklinePath(points: ChartPoint[], width: number, height: number, pad = 2): { path: string; last: { x: number; y: number } | null } {
  if (points.length < 2) return { path: "", last: null };
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const vs = sorted.map((p) => p.v);
  const v0 = Math.min(...vs);
  const v1 = Math.max(...vs);
  const t0 = sorted[0]!.t;
  const t1 = sorted[sorted.length - 1]!.t;
  const x = (t: number) => pad + ((t - t0) / (t1 - t0 || 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - v0) / (v1 - v0 || 1)) * (height - pad * 2);
  const path = sorted.map((p, i) => `${i ? "L" : "M"}${round1(x(p.t))} ${round1(y(p.v))}`).join(" ");
  const last = sorted[sorted.length - 1]!;
  return { path, last: { x: round1(x(last.t)), y: round1(y(last.v)) } };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
