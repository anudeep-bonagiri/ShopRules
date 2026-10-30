"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PriceRow } from "@/lib/db";
import { availableRanges, CHART_RANGES, deltaSummary, describeSeries, filterRange, fmtDateTime, fmtDelta, fmtMoneyFull, layoutPriceChart, nearestIndex, toChartPoints, type ChartMarker, type ChartRange } from "@/lib/chart";
import { cx } from "@/components/stitch";

// Price history for one product. One series, so one color (the primary token)
// and no legend box. Hairline solid grid, 2px line, 10 percent wash, end marker
// with a surface ring, selective labels (latest, low, high), a crosshair tooltip
// that snaps to the nearest point, range presets as buttons with aria-pressed,
// and a table twin for readers who want the numbers. Geometry comes from chart.ts
// so the extension HUD draws the same picture.

const HEIGHT = 200;
const SOURCE_LABEL: Record<string, string> = { listing: "listing when added", extension: "extension visit", refresh: "daily refresh", reprice: "reprice applied", check: "rule check" };

export function PriceChart({ history, markers = [], currency = "USD", caption }: { history: PriceRow[]; markers?: ChartMarker[]; currency?: string; caption?: string }) {
  const all = useMemo(() => toChartPoints(history.map((p) => ({ at: p.at, price: p.price, source: p.source }))), [history]);
  const ranges = useMemo(() => availableRanges(all), [all]);
  const [range, setRange] = useState<ChartRange>("ALL");
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [width, setWidth] = useState(600);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && Math.abs(w - width) > 1) setWidth(Math.max(240, Math.floor(w)));
    });
    ro.observe(el);
    setWidth(Math.max(240, Math.floor(el.getBoundingClientRect().width || 600)));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const points = useMemo(() => filterRange(all, ranges.includes(range) ? range : "ALL"), [all, range, ranges]);
  const layout = useMemo(() => layoutPriceChart({ points, markers, width, height: HEIGHT, currency }), [points, markers, width, currency]);
  const delta = deltaSummary(points);
  const tone = delta?.direction === "up" ? "success" : delta?.direction === "down" ? "critical" : "neutral";

  if (all.length === 0) return <p className="sr-sm">No price points yet. The first one is written when the listing is added.</p>;

  const hovered = hover !== null ? layout.pts[hover] : null;
  const latest = layout.last;
  const summary = describeSeries(points, currency);

  return (
    <div className="sr-stack sr-stack--tight">
      <div className="sr-row sr-row--between sr-row--wrap" style={{ gap: 8 }}>
        <div>
          <p className="sr-xs">Latest</p>
          <p className="sr-h2" style={{ marginTop: 0 }}>
            {latest ? fmtMoneyFull(latest.v, currency) : "n/a"}{" "}
            {delta ? (
              <span className={cx("sr-sm", `sr-tone-${tone}`)} style={{ fontWeight: 600 }}>
                {fmtDelta(delta, currency)} <span className="sr-xs" style={{ fontWeight: 400 }}>over {range === "ALL" ? "all history" : range}</span>
              </span>
            ) : null}
          </p>
        </div>
        <div className="sr-row" role="group" aria-label="Range" style={{ gap: 4 }}>
          {CHART_RANGES.map((r) => {
            const enabled = ranges.includes(r);
            return (
              <button key={r} type="button" className={cx("sr-chip sr-chip--sm", range === r && "sr-chip--active")} aria-pressed={range === r} disabled={!enabled} title={enabled ? `Show the last ${r === "ALL" ? "full history" : r}` : "Not enough history yet"} onClick={() => setRange(r)}>
                {r === "ALL" ? "All" : r}
              </button>
            );
          })}
          <button type="button" className={cx("sr-chip sr-chip--sm", table && "sr-chip--active")} aria-pressed={table} onClick={() => setTable((t) => !t)}>
            Table
          </button>
        </div>
      </div>

      {all.length < 2 ? (
        <p className="sr-sm sr-num">History starts at {fmtMoneyFull(all[0].v, currency)} on {fmtDateTime(all[0].t)}. More points arrive from the extension and the daily refresh.</p>
      ) : (
        <div ref={wrapRef} className="sr-chart" onPointerLeave={() => setHover(null)}>
          <svg
            className="sr-chart__svg"
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label={summary}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHover(nearestIndex(layout.pts, e.clientX - rect.left));
            }}
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHover(nearestIndex(layout.pts, e.clientX - rect.left));
            }}
          >
            {layout.yTicks.map((t) => (
              <g key={t.v}>
                <line x1={layout.plot.left} x2={layout.plot.right} y1={t.y} y2={t.y} className="sr-chart__grid" />
                <text x={layout.plot.left - 6} y={t.y + 3} textAnchor="end" className="sr-chart__tick">
                  {t.label}
                </text>
              </g>
            ))}
            {layout.xTicks.map((t) => (
              <text key={t.t} x={t.x} y={HEIGHT - 6} textAnchor="middle" className="sr-chart__tick">
                {t.label}
              </text>
            ))}
            {layout.markers.map((m, i) => (
              <g key={i} className={`sr-chart__marker sr-chart__marker--${m.kind}`}>
                <line x1={m.x} x2={m.x} y1={layout.plot.top} y2={layout.plot.bottom} />
                <title>{m.label}</title>
              </g>
            ))}
            <path d={layout.areaPath} className="sr-chart__area" />
            <path d={layout.path} className="sr-chart__line" />
            {layout.min && layout.max && layout.min !== layout.max ? (
              <>
                <text x={Math.min(layout.max.x, layout.plot.right - 30)} y={Math.max(layout.max.y - 8, layout.plot.top + 8)} textAnchor="middle" className="sr-chart__label">
                  high {fmtMoneyFull(layout.max.v, currency)}
                </text>
                <text x={Math.min(Math.max(layout.min.x, layout.plot.left + 30), layout.plot.right - 30)} y={Math.min(layout.min.y + 14, layout.plot.bottom - 2)} textAnchor="middle" className="sr-chart__label">
                  low {fmtMoneyFull(layout.min.v, currency)}
                </text>
              </>
            ) : null}
            {latest ? (
              <g>
                <circle cx={latest.x} cy={latest.y} r={6} className="sr-chart__ring" />
                <circle cx={latest.x} cy={latest.y} r={4} className="sr-chart__dot" />
              </g>
            ) : null}
            {hovered ? (
              <g>
                <line x1={hovered.x} x2={hovered.x} y1={layout.plot.top} y2={layout.plot.bottom} className="sr-chart__crosshair" />
                <circle cx={hovered.x} cy={hovered.y} r={6} className="sr-chart__ring" />
                <circle cx={hovered.x} cy={hovered.y} r={4} className="sr-chart__dot" />
              </g>
            ) : null}
          </svg>
          {hovered ? (
            <div className="sr-chart__tip" style={{ left: Math.min(Math.max(hovered.x, 70), width - 70) }} role="status" aria-live="polite">
              <strong className="sr-num">{fmtMoneyFull(hovered.v, currency)}</strong>
              <span>{fmtDateTime(hovered.t)}</span>
              {hovered.source ? <span>{SOURCE_LABEL[hovered.source] ?? hovered.source}</span> : null}
            </div>
          ) : null}
        </div>
      )}

      {layout.markers.length ? (
        <p className="sr-xs sr-chart__legend">
          <span className="sr-chart__key sr-chart__key--alert" aria-hidden /> alert raised <span className="sr-chart__key sr-chart__key--reprice" aria-hidden /> reprice applied
        </p>
      ) : null}
      {caption ? <p className="sr-xs">{caption}</p> : null}

      {table ? (
        <table className="sr-table sr-num">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Price</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p, i) => (
              <tr key={`${p.t}-${i}`}>
                <td>{fmtDateTime(p.t)}</td>
                <td>{fmtMoneyFull(p.v, currency)}</td>
                <td>{SOURCE_LABEL[p.source ?? ""] ?? p.source ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
