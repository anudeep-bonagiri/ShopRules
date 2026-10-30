"use client";

import type { SourceTrail } from "@/lib/source-trail";
import { summarizeTrail } from "@/lib/source-trail";
import { fmtDate, hostOf, StatusPill } from "@/components/stitch";

// Every Tavily call behind an alert, in the order it happened: the query and
// the official domains it was restricted to, each search result with its score
// and date (and whether it was read), each page extracted, the passages the
// verifier matched, and whether a model was consulted at all.
export function SourceTrailCard({ trail, sources }: { trail: SourceTrail | null | undefined; sources: Array<{ url: string; title: string; domain: string }> }) {
  if (!trail) {
    return (
      <div className="sr-stack">
        <h2 className="sr-h2">Sources read</h2>
        {sources.length === 0 ? (
          <p className="sr-sm">No sources recorded.</p>
        ) : (
          <div className="sr-rows">
            {sources.map((s) => (
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
      </div>
    );
  }
  const extractedByUrl = new Map(trail.extracted.map((e) => [e.url, e]));
  const passagesByUrl = new Map<string, number>();
  for (const p of trail.matched_passages) passagesByUrl.set(p.url, (passagesByUrl.get(p.url) ?? 0) + 1);
  const pathLabel = trail.path === "tavily_only" ? "No model needed" : trail.path === "forge" ? "Forged check" : trail.model ? `Nemotron ${trail.model.tier}, ${(trail.model.ms / 1000).toFixed(1)} s` : "Model consulted";
  return (
    <div className="sr-stack">
      <div className="sr-row sr-row--between">
        <h2 className="sr-h2">Source trail</h2>
        <StatusPill tone={trail.path === "tavily_only" ? "success" : "info"} caps={false}>
          {pathLabel}
        </StatusPill>
      </div>
      <p className="sr-xs">{summarizeTrail(trail)}</p>
      <div className="sr-wash sr-wash--neutral sr-stack sr-stack--tight">
        <p className="sr-xs sr-num">
          <span style={{ fontWeight: 600, color: "var(--sr-text)" }}>Tavily Search</span> {trail.mode === "strict" ? "restricted to" : "preferring"} {trail.include_domains.join(", ")}
          {trail.time_range ? `, past ${trail.time_range}` : ""}
        </p>
        <p className="sr-xs" style={{ wordBreak: "break-word" }}>
          Query: {trail.query}
        </p>
      </div>
      <div className="sr-rows">
        {trail.search_results.map((r) => {
          const ex = extractedByUrl.get(r.url);
          const hits = passagesByUrl.get(r.url) ?? 0;
          return (
            <div key={r.url} className="sr-stack" style={{ padding: "8px 0", gap: 4 }}>
              <div className="sr-row sr-row--wrap" style={{ gap: 6 }}>
                <span className="sr-xs" style={{ fontWeight: 600, color: "var(--sr-text)" }}>
                  {r.domain}
                </span>
                <span className="sr-xs sr-num">score {r.score.toFixed(2)}</span>
                {r.published_date ? <span className="sr-xs sr-num">{fmtDate(r.published_date)}</span> : null}
                {r.chosen ? (
                  ex?.ok ? (
                    <StatusPill tone="success" caps={false}>
                      extracted {ex.chars.toLocaleString()} chars
                    </StatusPill>
                  ) : (
                    <StatusPill tone="warning" caps={false}>
                      {ex?.error ? "extract failed" : "snippet only"}
                    </StatusPill>
                  )
                ) : (
                  <StatusPill tone="neutral" caps={false}>
                    not read
                  </StatusPill>
                )}
                {hits > 0 ? (
                  <StatusPill tone="success" caps={false}>
                    {hits} quote{hits === 1 ? "" : "s"} matched here
                  </StatusPill>
                ) : null}
              </div>
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="sr-link" style={{ fontSize: 12, display: "block", wordBreak: "break-word" }}>
                {r.title || r.url}
              </a>
            </div>
          );
        })}
      </div>
      <p className="sr-xs sr-num">
        {trail.tavily.search_calls} search, {trail.tavily.extract_calls} extract{trail.tavily.map_calls ? `, ${trail.tavily.map_calls} map` : ""}
        {trail.tavily.crawl_calls ? `, ${trail.tavily.crawl_calls} crawl` : ""} calls, about {trail.tavily.credits} Tavily credits.
        {trail.hash ? ` Source hash ${trail.hash.slice(0, 10)}: when it repeats, the model is skipped.` : ""}
        {hostOf(trail.search_results[0]?.url ?? "") ? "" : ""}
      </p>
    </div>
  );
}
