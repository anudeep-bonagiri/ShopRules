import type { VerifiedClaim } from "./schemas";

// The verifier sits outside the model. A claim is only "backed" when the quote
// the model attributed to a source actually appears in the text Tavily
// extracted from that source (or any source we fetched). Claims that fail are
// kept and shown as rejected so the seller sees what was dropped.

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9%$.,;:'"()\-/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shingles(text: string, n = 6): string[] {
  const words = text.split(" ").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(" "));
  return out;
}

export interface SourceText {
  url: string;
  text: string;
}

export function quoteIsBacked(quote: string, sources: SourceText[]): { backed: boolean; matched_url: string | null } {
  const q = normalize(quote);
  if (q.length < 20) return { backed: false, matched_url: null };
  const normalizedSources = sources.map((s) => ({ url: s.url, text: normalize(s.text) }));

  // Exact (normalized) substring match on the first 240 characters of the quote.
  const probe = q.slice(0, 240);
  for (const s of normalizedSources) {
    if (s.text.includes(probe)) return { backed: true, matched_url: s.url };
  }

  // Fuzzy fallback: most 6-word shingles of the quote appear in one source.
  const qs = shingles(q);
  if (qs.length === 0) return { backed: false, matched_url: null };
  for (const s of normalizedSources) {
    let hit = 0;
    for (const sh of qs) if (s.text.includes(sh)) hit += 1;
    if (hit / qs.length >= 0.8) return { backed: true, matched_url: s.url };
  }
  return { backed: false, matched_url: null };
}

export function verifyClaims(
  claims: Array<{ claim: string; quote: string; source_url: string }>,
  sources: SourceText[],
): { claims: VerifiedClaim[]; proposed: number; backed: number; rejected: number } {
  const out: VerifiedClaim[] = claims.map((c) => {
    // Prefer the source the model named, then fall back to any fetched source.
    const named = sources.filter((s) => s.url === c.source_url);
    const first = named.length ? quoteIsBacked(c.quote, named) : { backed: false, matched_url: null };
    const result = first.backed ? first : quoteIsBacked(c.quote, sources);
    return { ...c, backed: result.backed, matched_url: result.matched_url };
  });
  const backed = out.filter((c) => c.backed).length;
  return { claims: out, proposed: out.length, backed, rejected: out.length - backed };
}
