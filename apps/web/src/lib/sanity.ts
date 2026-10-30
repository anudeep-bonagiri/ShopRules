// Deterministic guardrails on every model verdict. Nemotron decides; this file
// checks that the decision is coherent with the rule, the product, the backed
// quotes, and what the seller was already told. Pure, no I/O, unit-tested.
//
// Why: a model can report a rate no source states, a date it made up, a reprice
// on a safety rule, or an alert about a different product. Each of those is
// caught here and either dropped, downgraded, or annotated so the UI can show
// what was adjusted. Nothing here invents facts; it only removes or softens.

import type { RuleCheck, RuleFamily, VerifiedClaim } from "./schemas";

export type GuardrailSeverity = "drop" | "adjust" | "note";

export interface GuardrailIssue {
  code:
    | "rate_out_of_range"
    | "rate_on_non_tariff_rule"
    | "rate_not_in_quotes"
    | "date_implausible"
    | "action_family_mismatch"
    | "off_topic"
    | "off_domain_claim"
    | "duplicate_of_previous"
    | "severity_adjusted"
    | "rate_corrected_from_levels"
    | "no_backed_claims"
    | "facilitator_informational";
  severity: GuardrailSeverity;
  message: string;
}

export interface PreviousAlertLike {
  headline: string;
  created_at: string;
  impact: { tariff_rate_change_pct: number | null; estimated_cost_change_pct: number | null; effective_date: string | null };
}

export interface AuditInput {
  check: RuleCheck;
  verified: VerifiedClaim[];
  rule: { family: RuleFamily; title: string; query: string; state: string | null; include_domains: string[]; include_domains_mode: "strict" | "prefer" };
  product: {
    title: string;
    marketplace: string;
    profile: { category: string; product_type: string; keywords: string[]; materials: string[]; origin_country: string | null; hts_candidates: Array<{ code: string; description: string }> };
  };
  previous: PreviousAlertLike[];
  /** Full extracted source texts, so a short quote can be read with its surrounding sentence. */
  sources?: Array<{ url: string; text: string }>;
  today: string; // YYYY-MM-DD
}

export interface AuditResult {
  /** True when the alert should not be raised at all. */
  drop: boolean;
  /** Why it was dropped, when drop is true. */
  dropReason: string | null;
  check: RuleCheck;
  verified: VerifiedClaim[];
  issues: GuardrailIssue[];
}

const ALLOWED_ACTIONS: Record<RuleFamily, Array<RuleCheck["action"]["type"]>> = {
  tariff: ["reprice", "review", "none"],
  safety: ["compliance_step", "review", "none"],
  tax: ["register_tax", "review", "none"],
  policy: ["compliance_step", "review", "none"],
};

const FAMILY_VOCAB: Record<RuleFamily, string[]> = {
  tariff: ["tariff", "duty", "duties", "section 301", "section 232", "hts", "harmonized", "customs", "import", "ad valorem", "exclusion", "de minimis", "ieepa", "reciprocal"],
  safety: ["cpsc", "recall", "safety", "standard", "astm", "lead", "phthalate", "warning", "label", "labeling", "testing", "certificate", "fda", "prop 65", "flammab", "choking", "battery", "ul "],
  tax: ["sales tax", "nexus", "threshold", "remote seller", "marketplace facilitator", "collect", "register", "permit", "use tax", "economic nexus", "transactions", "gross receipts"],
  policy: ["policy", "prohibited", "restricted", "listing", "seller", "handmade", "compliance", "requirement", "marketplace", "terms"],
};

const COUNTRY_NAMES: Record<string, string> = { CN: "china", VN: "vietnam", IN: "india", MX: "mexico", CA: "canada", US: "united states", TW: "taiwan", KR: "korea", JP: "japan", TH: "thailand", ID: "indonesia", BD: "bangladesh", TR: "turkey", IT: "italy", DE: "germany", PK: "pakistan", KH: "cambodia", MY: "malaysia", PH: "philippines", GB: "united kingdom" };

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function inDomains(url: string, domains: string[]): boolean {
  const host = domainOf(url);
  return domains.some((d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`));
}

const STOP = new Set(["the", "and", "for", "are", "not", "any", "all", "per", "may", "its", "our", "you", "has", "was", "can", "one", "two", "new", "use", "via", "who", "how", "act", "but", "nor", "off", "out", "own", "set", "see", "such", "with", "from", "that", "this", "into", "than", "then", "under", "over", "about", "after", "before", "which", "their", "there", "these", "those", "will", "shall", "must", "have", "been", "were", "your", "product", "products", "listing", "seller", "sellers", "rule", "rules", "united", "states"]);

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[^a-z0-9%$.\- ]+/g, " ").split(/\s+/)) {
    const t = w.replace(/^[.\-]+|[.\-]+$/g, "");
    if (t.length < 3 || STOP.has(t) || /^\d+$/.test(t)) continue;
    out.add(t.length > 6 ? t.slice(0, 6) : t); // crude stem: "lamps"/"lamp", "tariffs"/"tariff"
  }
  return out;
}

/** All percentages mentioned in a text, as numbers. "25 percent", "37.5%", "7.5 percentage points". */
export function percentsIn(text: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent(?:age)?(?:\s+points?)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(Number(m[1]));
  return out;
}

/**
 * "from 7.5 percent to 25 percent" means a change of 17.5 points. When a quote
 * states old and new levels this returns the implied change, else null.
 */
export function impliedChangeFromLevels(text: string): number | null {
  const re = /from\s+(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent)\s+(?:ad valorem\s+)?to\s+(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent)/i;
  const m = text.match(re);
  if (!m) return null;
  const change = Number(m[2]) - Number(m[1]);
  return Math.round(change * 100) / 100;
}

const COUNTRY_WORDS = Object.values(COUNTRY_NAMES);

/** Four-digit HTS headings named in a text ("heading 9405", "headings 6403 and 6404"). */
export function headingsIn(text: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:heading|headings|subheading|hts)\s+(\d{4})(?:\.\d{2})?(?:\s*(?:,|and|or)\s*(\d{4})(?:\.\d{2})?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.add(m[1]);
    if (m[2]) out.add(m[2]);
  }
  // bare "9405.20" style codes
  const re2 = /\b(\d{4})\.\d{2}(?:\.\d{2})?\b/g;
  while ((m = re2.exec(text))) out.add(m[1]);
  return Array.from(out);
}

/**
 * The passage around a quote in its source (about 400 characters before and
 * 200 after), so the subject check sees "heading 9405 ... products of China"
 * even when the model quoted only the rate sentence. Falls back to the quote.
 */
export function quoteContext(quote: string, sources: Array<{ url: string; text: string }>, preferUrl?: string | null): string {
  const probe = quote.trim().slice(0, 60).toLowerCase();
  if (probe.length < 15) return quote;
  const ordered = preferUrl ? [...sources.filter((s) => s.url === preferUrl), ...sources.filter((s) => s.url !== preferUrl)] : sources;
  for (const s of ordered) {
    const hay = s.text.toLowerCase();
    const at = hay.indexOf(probe);
    if (at >= 0) return s.text.slice(Math.max(0, at - 400), Math.min(s.text.length, at + quote.length + 200));
  }
  return quote;
}

/**
 * Drops sentences that say what a notice does NOT cover ("does not change
 * requirements for toys", "footwear of heading 6403 is not affected", "products
 * of other countries ... are not covered"), so a product named only in an
 * exclusion does not count as the subject.
 */
export function stripNegatedClauses(text: string): string {
  const NEG = /\b(?:does not|do not|did not|will not|is not|are not|not)\s+(?:apply|applies|change|affect|affected|cover|covered|include|included|modify|modified|subject|eligible|extend)\b|\b(?:except|excluding|other than|exempt from|outside the scope|unaffected|remain(?:s)? (?:at|unchanged))\b|\bno other\b/i;
  return text
    .split(/(?<=[.;])\s+/)
    .filter((sentence) => !NEG.test(sentence))
    .join(" ");
}

/** True when the rate is stated directly or is the difference of two stated rates. */
export function rateSupportedByText(rate: number, text: string): boolean {
  const pcts = percentsIn(text);
  const close = (a: number, b: number) => Math.abs(a - b) < 0.051;
  if (pcts.some((p) => close(p, Math.abs(rate)))) return true;
  for (let i = 0; i < pcts.length; i++) for (let j = 0; j < pcts.length; j++) if (i !== j && close(pcts[j] - pcts[i], rate)) return true;
  return false;
}

function plausibleDate(iso: string | null, today: string): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const now = Date.parse(`${today}T00:00:00Z`);
  const year = Number(m[1]);
  if (year < 2018) return null; // tariff and nexus regimes that matter start after Wayfair (2018)
  if (t > now + 548 * 86400000) return null; // more than 18 months out is a guess
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function normalizeHeadline(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function auditRuleCheck(input: AuditInput): AuditResult {
  const issues: GuardrailIssue[] = [];
  const check: RuleCheck = JSON.parse(JSON.stringify(input.check)) as RuleCheck;
  let verified: VerifiedClaim[] = input.verified.map((c) => ({ ...c }));
  const { rule, product } = input;

  // 1. Claims must come from the rule's official domains when the rule is strict.
  if (rule.include_domains_mode === "strict" && rule.include_domains.length) {
    let offDomain = 0;
    verified = verified.map((c) => {
      const url = c.matched_url ?? c.source_url;
      if (c.backed && url && !inDomains(url, rule.include_domains)) {
        offDomain += 1;
        return { ...c, backed: false, matched_url: null };
      }
      return c;
    });
    if (offDomain) issues.push({ code: "off_domain_claim", severity: "adjust", message: `${offDomain} claim${offDomain === 1 ? "" : "s"} quoted a page outside ${rule.include_domains.join(", ")} and ${offDomain === 1 ? "was" : "were"} marked unbacked.` });
  }
  const backedText = verified.filter((c) => c.backed).map((c) => `${c.claim} ${c.quote}`).join(" \n ");
  const backedCount = verified.filter((c) => c.backed).length;

  if (check.relevance === "no_change") return { drop: true, dropReason: "The model found no change that touches this product.", check, verified, issues };
  if (backedCount === 0) {
    issues.push({ code: "no_backed_claims", severity: "drop", message: "No claim could be matched to the source text." });
    return { drop: true, dropReason: "No claim was backed by the source text.", check, verified, issues };
  }

  // 2. Numbers: in range, on the right kind of rule, and stated by a backed quote.
  const imp = check.impact;
  if (imp.tariff_rate_change_pct != null && (!Number.isFinite(imp.tariff_rate_change_pct) || imp.tariff_rate_change_pct < -100 || imp.tariff_rate_change_pct > 200)) {
    issues.push({ code: "rate_out_of_range", severity: "adjust", message: `Duty change of ${imp.tariff_rate_change_pct} points is outside any real tariff action and was dropped.` });
    imp.tariff_rate_change_pct = null;
  }
  if (imp.estimated_cost_change_pct != null && (!Number.isFinite(imp.estimated_cost_change_pct) || imp.estimated_cost_change_pct < -90 || imp.estimated_cost_change_pct > 300)) {
    issues.push({ code: "rate_out_of_range", severity: "adjust", message: `Estimated cost change of ${imp.estimated_cost_change_pct}% is implausible and was dropped.` });
    imp.estimated_cost_change_pct = null;
  }
  if (rule.family !== "tariff" && imp.tariff_rate_change_pct != null) {
    issues.push({ code: "rate_on_non_tariff_rule", severity: "adjust", message: `A duty rate change was reported on a ${rule.family} rule and was dropped; tariff rules own duty math.` });
    imp.tariff_rate_change_pct = null;
  }
  if (imp.tariff_rate_change_pct != null) {
    const implied = impliedChangeFromLevels(backedText);
    if (implied != null && Math.abs(implied - imp.tariff_rate_change_pct) > 0.051) {
      const levels = percentsIn(backedText);
      const reportedALevel = levels.some((l) => Math.abs(l - Math.abs(imp.tariff_rate_change_pct!)) < 0.051);
      if (reportedALevel) {
        issues.push({ code: "rate_corrected_from_levels", severity: "adjust", message: `The quote moves the rate from one level to another; the change is ${implied} points, not the ${imp.tariff_rate_change_pct} the model reported.` });
        imp.tariff_rate_change_pct = implied;
      }
    }
  }
  if (imp.tariff_rate_change_pct != null && imp.tariff_rate_change_pct !== 0 && !rateSupportedByText(imp.tariff_rate_change_pct, backedText)) {
    issues.push({ code: "rate_not_in_quotes", severity: "adjust", message: `No backed quote states a ${Math.abs(imp.tariff_rate_change_pct)} point change (or two rates that differ by it), so the number was dropped and the alert needs review.` });
    imp.tariff_rate_change_pct = null;
    if (check.relevance === "affects") check.relevance = "might_affect";
  }

  // 3. Dates.
  if (imp.effective_date) {
    const ok = plausibleDate(imp.effective_date, input.today);
    if (!ok) {
      issues.push({ code: "date_implausible", severity: "adjust", message: `Effective date ${imp.effective_date} is not a plausible date for this rule and was dropped.` });
      imp.effective_date = null;
    } else imp.effective_date = ok;
  }

  // 4. Action type must fit the rule family; a reprice needs a cost number.
  if (!ALLOWED_ACTIONS[rule.family].includes(check.action.type)) {
    issues.push({ code: "action_family_mismatch", severity: "adjust", message: `Action "${check.action.type}" does not fit a ${rule.family} rule; changed to review.` });
    check.action.type = "review";
  }
  if (check.action.type === "reprice" && imp.tariff_rate_change_pct == null && imp.estimated_cost_change_pct == null) {
    issues.push({ code: "action_family_mismatch", severity: "adjust", message: "A reprice was proposed without any cost change; changed to review." });
    check.action.type = "review";
  }

  // 5. Off-topic. Two kinds of evidence:
  //    product terms (what it is, what it is made of, where it is from, its heading)
  //    rule terms (the subject of the watch rule, minus generic words).
  //    A verdict needs product overlap, or strong rule overlap with no contradiction.
  //    A contradiction is a quote that names other headings or other origin
  //    countries without naming this product's.
  const productTerms = new Set<string>([
    ...tokens(product.profile.category),
    ...tokens(product.profile.product_type),
    ...product.profile.keywords.flatMap((k) => [...tokens(k)]),
    ...product.profile.materials.flatMap((k) => [...tokens(k)]),
    ...product.profile.hts_candidates.flatMap((h) => [...tokens(h.description), h.code]),
  ]);
  const origin = product.profile.origin_country ? COUNTRY_NAMES[product.profile.origin_country.toUpperCase()] : null;
  if (origin) for (const t of tokens(origin)) productTerms.add(t);
  // Six-letter stems (see tokens()) of words every rule in a family shares; they do not identify a subject.
  const GENERIC = new Set(["standa", "safety", "duty", "duties", "tariff", "sectio", "rule", "rules", "requir", "policy", "thresh", "nexus", "sales", "econom", "seller", "remote", "market", "state", "collec", "produc", "import", "additi", "notice", "change", "update", "mandat"]);
  const ruleTerms = new Set<string>([...tokens(rule.title), ...tokens(rule.query)].filter((t) => !GENERIC.has(t) && !/^\d{4}$/.test(t)));
  if (rule.state) ruleTerms.add(rule.state.toLowerCase());
  // Only verified quotes count, read with their surrounding source passage. The
  // headline and claim prose are the model's own words and can echo the rule's
  // vocabulary, so they are not evidence of subject.
  const body = verified
    .filter((c) => c.backed)
    .map((c) => stripNegatedClauses(input.sources?.length ? quoteContext(c.quote, input.sources, c.matched_url ?? c.source_url) : c.quote))
    .join(" \n ")
    .toLowerCase();
  const bodyTokens = tokens(body);
  let productOverlap = 0;
  let ruleOverlap = 0;
  for (const t of bodyTokens) {
    if (productTerms.has(t)) productOverlap += 1;
    if (ruleTerms.has(t)) ruleOverlap += 1;
  }
  const familyHit = FAMILY_VOCAB[rule.family].some((v) => body.includes(v));
  const myHeadings = new Set(product.profile.hts_candidates.map((h) => h.code.slice(0, 4)));
  const namedHeadings = headingsIn(body);
  const otherHeadingsOnly = namedHeadings.length > 0 && !namedHeadings.some((h) => myHeadings.has(h));
  const namedCountries = COUNTRY_WORDS.filter((c) => body.includes(c));
  const otherCountriesOnly = rule.family === "tariff" && origin != null && namedCountries.length > 0 && !namedCountries.includes(origin);
  const contradiction = otherHeadingsOnly || otherCountriesOnly;
  if (contradiction && productOverlap <= 1) {
    const why = otherHeadingsOnly ? `heading${namedHeadings.length === 1 ? "" : "s"} ${namedHeadings.join(", ")} rather than ${Array.from(myHeadings).join(", ") || "this product's"}` : `${namedCountries.join(", ")} rather than ${origin}`;
    issues.push({ code: "off_topic", severity: "drop", message: `The backed quotes are about ${why}; this notice does not touch this product.` });
    return { drop: true, dropReason: "The sources are about a different product or origin.", check, verified, issues };
  }
  const subjectHit = productOverlap > 0 || ruleOverlap >= (rule.family === "tariff" || rule.family === "safety" ? 2 : 1);
  if (!subjectHit) {
    // A tariff on "all imports" names no product; keep it, but it is unconfirmed.
    const universalTariff = rule.family === "tariff" && familyHit && (check.impact.tariff_rate_change_pct != null || check.impact.effective_date != null);
    if (!universalTariff) {
      issues.push({ code: "off_topic", severity: "drop", message: "The backed quotes mention neither this product nor the subject of this rule." });
      return { drop: true, dropReason: "The sources do not talk about this product or this rule.", check, verified, issues };
    }
    if (check.relevance === "affects") {
      issues.push({ code: "off_topic", severity: "adjust", message: "The quotes never name this product type, so relevance was lowered to might affect." });
      check.relevance = "might_affect";
    }
  } else if ((rule.family === "tariff" || rule.family === "safety") && productOverlap === 0 && check.relevance === "affects") {
    issues.push({ code: "off_topic", severity: "adjust", message: "The quotes are about this rule's subject but never mention this product type, so relevance was lowered to might affect." });
    check.relevance = "might_affect";
  }

  // 6. Already told: same rate and date, or the same headline, within 45 days.
  const cutoff = Date.parse(`${input.today}T00:00:00Z`) - 45 * 86400000;
  const recent = input.previous.filter((p) => Date.parse(p.created_at) >= cutoff);
  const sameHeadline = recent.find((p) => normalizeHeadline(p.headline) === normalizeHeadline(check.headline));
  const sameFacts = recent.find((p) => (imp.tariff_rate_change_pct != null || imp.effective_date) && p.impact.tariff_rate_change_pct === imp.tariff_rate_change_pct && p.impact.effective_date === imp.effective_date && p.impact.estimated_cost_change_pct === imp.estimated_cost_change_pct);
  if (sameHeadline || sameFacts) {
    issues.push({ code: "duplicate_of_previous", severity: "drop", message: "This repeats an alert already raised for this rule." });
    return { drop: true, dropReason: "Same finding as a recent alert for this rule.", check, verified, issues };
  }

  // 7. Severity should follow the numbers, not the prose.
  const rate = Math.abs(imp.tariff_rate_change_pct ?? 0);
  const cost = Math.abs(imp.estimated_cost_change_pct ?? 0);
  if (check.impact.severity === "high" && rule.family === "tariff" && rate < 5 && cost < 5) {
    issues.push({ code: "severity_adjusted", severity: "adjust", message: "High severity with under 5 points of duty change was lowered to medium." });
    check.impact.severity = "medium";
  }
  if (check.impact.severity === "low" && (rate >= 10 || cost >= 10)) {
    issues.push({ code: "severity_adjusted", severity: "adjust", message: "Low severity with a double-digit cost change was raised to medium." });
    check.impact.severity = "medium";
  }
  if (check.relevance === "might_affect" && check.impact.severity === "high") {
    issues.push({ code: "severity_adjusted", severity: "adjust", message: "An unconfirmed match cannot be high severity; lowered to medium." });
    check.impact.severity = "medium";
  }

  // 8. Sales tax on a facilitator marketplace: Amazon and Etsy collect and remit
  // in every nexus state, so a threshold notice is information, not a task.
  const facilitator = rule.family === "tax" && (input.product.marketplace === "amazon" || input.product.marketplace === "etsy");
  if (facilitator) {
    const name = input.product.marketplace === "amazon" ? "Amazon" : "Etsy";
    if (check.impact.severity !== "low") check.impact.severity = "low";
    if (check.relevance === "affects") check.relevance = "might_affect";
    if (check.action.type === "register_tax") check.action = { ...check.action, type: "review", title: `For information: ${name} collects sales tax here as a marketplace facilitator` };
    issues.push({ code: "facilitator_informational", severity: "note", message: `${name} collects and remits sales tax in this state as a marketplace facilitator, so this notice is informational and was set to low severity. It matters only for sales outside ${name}.` });
  }

  return { drop: false, dropReason: null, check, verified, issues };
}

/** Compact history block for the prompt: what the seller was already told, and how the price moved. */
export function historyContext(previous: PreviousAlertLike[], prices: Array<{ at: string; price: number }>, today: string): string {
  const lines: string[] = [];
  const recent = [...previous].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);
  if (recent.length) {
    lines.push("Alerts already raised for this rule (do not repeat them; report only what is new or different):");
    for (const p of recent) {
      const bits = [p.created_at.slice(0, 10), p.headline];
      if (p.impact.tariff_rate_change_pct != null) bits.push(`${p.impact.tariff_rate_change_pct > 0 ? "+" : ""}${p.impact.tariff_rate_change_pct} pts`);
      if (p.impact.effective_date) bits.push(`effective ${p.impact.effective_date}`);
      lines.push(`- ${bits.join(", ")}`);
    }
  }
  if (prices.length >= 2) {
    const sorted = [...prices].sort((a, b) => a.at.localeCompare(b.at));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const pct = first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0;
    lines.push(`Listing price trend: ${first.price.toFixed(2)} on ${first.at.slice(0, 10)} to ${last.price.toFixed(2)} on ${last.at.slice(0, 10)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%, ${sorted.length} points). Today is ${today}.`);
  }
  return lines.join("\n");
}
