"use client";

// Chart-like helpers that stay out of stitch.tsx: the evidence bar and the
// price sparkline. Badges and stats moved to stitch.tsx (StatusPill, MetricCard).

export function EvidenceBar({ proposed, backed, rejected, compact = false }: { proposed: number; backed: number; rejected: number; compact?: boolean }) {
  const total = Math.max(proposed, 1);
  const b = (backed / total) * 100;
  const r = (rejected / total) * 100;
  return (
    <div className="sr-stack" style={{ gap: 4 }}>
      <div className="sr-evidence-bar" role="img" aria-label={`${backed} claims backed by source text, ${rejected} rejected by the verifier`} title={`${backed} backed, ${rejected} rejected`}>
        <span style={{ width: `${b}%`, background: "var(--sr-primary)" }} />
        <span style={{ width: `${r}%`, background: "var(--sr-critical)" }} />
      </div>
      {!compact ? (
        <p className="sr-xs sr-num">
          {proposed} proposed, {backed} backed, {rejected} rejected
        </p>
      ) : null}
    </div>
  );
}

export function Sparkline({ points, markers = [] }: { points: Array<{ at: string; price: number }>; markers?: string[] }) {
  if (points.length < 2) {
    return <p className="sr-sm sr-num">{points.length === 1 ? `History starts now at ${points[0].price.toFixed(2)}.` : "No price points yet."}</p>;
  }
  const w = 600;
  const h = 56;
  const xs = points.map((p) => new Date(p.at).getTime());
  const ys = points.map((p) => p.price);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs) || minX + 1;
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = maxY - minY || 1;
  const px = (x: number) => ((x - minX) / (maxX - minX || 1)) * (w - 8) + 4;
  const py = (y: number) => h - 6 - ((y - minY) / spanY) * (h - 12);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(xs[i]).toFixed(1)},${py(p.price).toFixed(1)}`).join(" ");
  return (
    <svg className="sr-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Price history">
      <path d={d} fill="none" stroke="#008060" strokeWidth="2" />
      {markers.map((m, i) => {
        const x = px(new Date(m).getTime());
        return <line key={i} x1={x} x2={x} y1={2} y2={h - 2} stroke="#d72c0d" strokeDasharray="3 3" strokeWidth="1" />;
      })}
      <circle cx={px(xs[xs.length - 1])} cy={py(ys[ys.length - 1])} r="3" fill="#008060" />
    </svg>
  );
}
