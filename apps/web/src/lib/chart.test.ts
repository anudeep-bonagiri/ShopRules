import { test } from "node:test";
import assert from "node:assert/strict";
import { availableRanges, deltaSummary, filterRange, fmtDelta, layoutPriceChart, nearestIndex, niceTicks, sparklinePath, timeTicks, toChartPoints, describeSeries } from "./chart.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-10-29T12:00:00Z");
const pts = toChartPoints([
  { at: "2026-08-01T00:00:00Z", price: "29.99", source: "listing" },
  { at: "2026-09-15T00:00:00Z", price: 31.5, source: "extension" },
  { at: "2026-10-20T00:00:00Z", price: 28.0, source: "refresh" },
  { at: "2026-10-28T00:00:00Z", price: 33.0, source: "reprice" },
]);

test("toChartPoints parses, sorts, and drops junk", () => {
  const p = toChartPoints([{ at: "bad", price: 1 }, { at: "2026-01-02T00:00:00Z", price: "x" }, { at: "2026-01-03T00:00:00Z", price: 2 }, { at: "2026-01-01T00:00:00Z", price: 1 }]);
  assert.deepEqual(p.map((x) => x.v), [1, 2]);
});

test("filterRange keeps the carry-in point so the line enters from the left", () => {
  const w = filterRange(pts, "1W", now);
  assert.equal(w.length, 2);
  assert.equal(w[0].v, 28.0, "carry-in value is the last point before the window");
  assert.equal(w[0].t, now - 7 * DAY);
  assert.equal(filterRange(pts, "ALL", now).length, 4);
  assert.deepEqual(availableRanges(pts, now), ["1W", "1M", "3M", "ALL"]);
  assert.deepEqual(availableRanges(pts.slice(0, 1), now), ["ALL"]);
});

test("niceTicks produces clean steps that bracket the data", () => {
  const t = niceTicks(28, 33, 4);
  assert.ok(t[0] <= 28 && t[t.length - 1] >= 33);
  assert.ok(t.every((v, i) => i === 0 || Math.abs(v - t[i - 1] - (t[1] - t[0])) < 1e-6), "even steps");
  assert.ok(niceTicks(10, 10).length >= 2, "flat series still gets a band");
});

test("timeTicks aligns to days or weeks and stays sparse", () => {
  const t = timeTicks(Date.parse("2026-08-01T00:00:00Z"), Date.parse("2026-10-28T00:00:00Z"), 4);
  assert.ok(t.length >= 2 && t.length <= 8);
  for (const v of t) assert.equal(new Date(v).getUTCHours(), 0);
});

test("layout maps the extremes to the plot box and finds min, max, last", () => {
  const l = layoutPriceChart({ points: pts, width: 600, height: 180, markers: [{ t: Date.parse("2026-10-01T00:00:00Z"), kind: "alert", label: "Duty up" }, { t: Date.parse("2020-01-01T00:00:00Z"), kind: "alert", label: "old" }] });
  assert.ok(l.path.startsWith("M"));
  assert.ok(l.areaPath.endsWith("Z"));
  assert.equal(l.min?.v, 28.0);
  assert.equal(l.max?.v, 33.0);
  assert.equal(l.last?.v, 33.0);
  assert.equal(l.first?.x, l.plot.left);
  assert.equal(l.last?.x, l.plot.right);
  assert.equal(l.markers.length, 1, "markers outside the domain are dropped");
  assert.ok(l.yTicks.every((t) => t.y >= l.plot.top - 0.1 && t.y <= l.plot.bottom + 0.1));
  assert.ok(l.yTicks[0].label.startsWith("$"));
  const idx = nearestIndex(l.pts, l.pts[2].x + 3);
  assert.equal(idx, 2);
});

test("delta summary and description", () => {
  const d = deltaSummary(pts);
  assert.equal(d?.direction, "up");
  assert.equal(d?.abs, 3.01);
  assert.match(fmtDelta(d), /^\+\$3\.01 \(\+10\.0%\)$/);
  assert.equal(fmtDelta({ abs: 0, pct: 0, direction: "flat" }), "Unchanged");
  assert.match(describeSeries(pts), /4 points.*Latest \$33\.00.*low \$28\.00, high \$33\.00/);
  assert.equal(describeSeries([]), "No price points yet.");
});

test("sparkline path stays inside its box", () => {
  const s = sparklinePath(pts, 120, 32);
  assert.ok(s.path.startsWith("M2 ") || s.path.startsWith("M2."));
  assert.ok(s.last && s.last.x <= 118 && s.last.y >= 2 && s.last.y <= 30);
  assert.equal(sparklinePath(pts.slice(0, 1), 120, 32).path, "");
});
