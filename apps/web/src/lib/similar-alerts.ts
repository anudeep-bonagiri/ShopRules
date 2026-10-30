// Sibling alerts for a dismissal: the other open alerts the seller's reason
// most likely covers too, offered as "also dismiss N similar". Pure, unit-tested.

export interface SimilarCandidate {
  id: string;
  product_id: string;
  rule_id: string;
  family: string;
  kind?: "rule" | "price";
  status: string;
  headline: string;
  product_title?: string;
}

export interface SimilarMatch {
  id: string;
  headline: string;
  product_title: string | null;
}

function stem(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|a|an|for|of|on|in|to|from|and|or|your|this|is|are|now|new)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ");
}

/**
 * Open alerts the dismissal reason plausibly covers:
 *   scope product  the same product and family only;
 *   otherwise      the same family across the workspace, when the rule key
 *                  matches (every "tax-*" nexus state counts as one key) or
 *                  the headline starts the same way.
 */
export function similarAlerts(target: SimilarCandidate, open: SimilarCandidate[], ruleKeys: Map<string, string>, scope: "product" | "family" | "account" | null): SimilarMatch[] {
  const keyOf = (a: SimilarCandidate): string | null => {
    const k = ruleKeys.get(a.rule_id) ?? null;
    if (!k) return null;
    return k.startsWith("tax-") ? "tax" : k;
  };
  const targetKey = keyOf(target);
  const targetStem = stem(target.headline);
  return open
    .filter((a) => a.id !== target.id && a.status === "new" && a.kind !== "price" && a.family === target.family)
    .filter((a) => (scope === "product" ? a.product_id === target.product_id : true))
    .filter((a) => {
      const k = keyOf(a);
      if (targetKey && k && k === targetKey) return true;
      return targetStem.length >= 12 && stem(a.headline) === targetStem;
    })
    .slice(0, 50)
    .map((a) => ({ id: a.id, headline: a.headline, product_title: a.product_title ?? null }));
}
