// Competitor price position. Pure, no I/O, unit-tested; used by the compare
// route and mirrored in the extension HUD.
import type { CompetitorListings } from "./schemas";

/** Listings with a visible price needed before Shop Rules calls a position. */
export const COMPARE_MIN_SAMPLE = 3;

/**
 * Where the seller's price sits against the competitor median. Arithmetic, not a
 * judgement, and no verdict from a sample under COMPARE_MIN_SAMPLE: one
 * competitor is an anecdote. Pure, unit-tested.
 */
export function comparePosition(sortedPrices: number[], mine: number | null): { position: CompetitorListings["price_position"]; median: number | null; note: string | null } {
  const n = sortedPrices.length;
  if (n === 0) return { position: "unknown", median: null, note: "No competitor listing showed a price." };
  const median = n % 2 ? sortedPrices[(n - 1) / 2] : (sortedPrices[n / 2 - 1] + sortedPrices[n / 2]) / 2;
  if (mine == null || mine <= 0) return { position: "unknown", median, note: `Median of ${n} priced listing${n === 1 ? "" : "s"} is ${median.toFixed(2)}; no price on this page to compare.` };
  if (n < COMPARE_MIN_SAMPLE) {
    return { position: "unknown", median, note: `Only ${n} listing${n === 1 ? "" : "s"} with a visible price (median ${median.toFixed(2)}). Shop Rules needs ${COMPARE_MIN_SAMPLE} before calling a position.` };
  }
  const ratio = mine / median;
  const position: CompetitorListings["price_position"] = ratio < 0.9 ? "below_market" : ratio > 1.1 ? "above_market" : "at_market";
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  const where = position === "above_market" ? `${pct}% above` : position === "below_market" ? `${pct}% below` : "within 10% of";
  return { position, median, note: `Your ${mine.toFixed(2)} is ${where} the median of ${median.toFixed(2)} across ${n} listings with a visible price.` };
}
