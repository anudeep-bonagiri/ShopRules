import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRuleCheck, headingsIn, quoteContext, stripNegatedClauses, historyContext, impliedChangeFromLevels, percentsIn, rateSupportedByText, type AuditInput } from "./sanity.ts";

const lamp: AuditInput["product"] = {
  title: "USB-C Rechargeable LED Desk Lamp with Lithium Battery",
  marketplace: "amazon",
  profile: { category: "Lighting", product_type: "desk lamp", keywords: ["desk lamp", "led lamp", "rechargeable lamp"], materials: ["aluminum alloy", "abs plastic", "lithium-ion battery"], origin_country: "CN", hts_candidates: [{ code: "9405", description: "Lamps and lighting fittings" }] },
};
const tariffRule: AuditInput["rule"] = { family: "tariff", title: "Section 301 duty on lamps from China", query: "Section 301 China tariff lamps 9405 2026", state: null, include_domains: ["ustr.gov", "cbp.gov", "federalregister.gov"], include_domains_mode: "strict" };
const QUOTE = "the additional duty on products of China classified under heading 9405 will increase from 25 percent to 37.5 percent ad valorem effective January 1, 2026";

function base(over: Partial<AuditInput> = {}): AuditInput {
  return {
    check: {
      relevance: "affects",
      headline: "Section 301 duty on lamps from China rises from 25% to 37.5% on January 1, 2026",
      claims: [{ claim: "Duty rises 12.5 points", quote: QUOTE, source_url: "https://ustr.gov/notice" }],
      impact: { severity: "high", effective_date: "2026-01-01", tariff_rate_change_pct: 12.5, estimated_cost_change_pct: null, nexus: null },
      action: { type: "reprice", title: "Reprice the lamp", steps: ["Raise the price"], rationale: "Duty up" },
    },
    verified: [{ claim: "Duty rises 12.5 points", quote: QUOTE, source_url: "https://ustr.gov/notice", backed: true, matched_url: "https://ustr.gov/notice" }],
    rule: tariffRule,
    product: lamp,
    previous: [],
    today: "2026-10-29",
    ...over,
  };
}

test("a well-formed tariff alert passes untouched", () => {
  const r = auditRuleCheck(base());
  assert.equal(r.drop, false);
  assert.equal(r.issues.length, 0);
  assert.equal(r.check.impact.tariff_rate_change_pct, 12.5);
  assert.equal(r.check.action.type, "reprice");
});

test("percent parsing and rate support", () => {
  assert.deepEqual(percentsIn("from 25 percent to 37.5 percent, plus 7.5 percentage points"), [25, 37.5, 7.5]);
  assert.ok(rateSupportedByText(12.5, QUOTE));
  assert.ok(rateSupportedByText(25, "an additional 25% duty"));
  assert.ok(!rateSupportedByText(30, QUOTE));
});

test("a rate no backed quote states is dropped and relevance lowered", () => {
  const i = base();
  i.check.impact.tariff_rate_change_pct = 30;
  const r = auditRuleCheck(i);
  assert.equal(r.drop, false);
  assert.equal(r.check.impact.tariff_rate_change_pct, null);
  assert.equal(r.check.relevance, "might_affect");
  assert.ok(r.issues.some((x) => x.code === "rate_not_in_quotes"));
  assert.equal(r.check.action.type, "review", "no cost number means no reprice");
});

test("duty math never rides on a safety rule", () => {
  const i = base({ rule: { ...tariffRule, family: "safety", title: "CPSC battery safety for lamps", include_domains: ["cpsc.gov"] } });
  i.verified[0]!.matched_url = "https://www.cpsc.gov/notice";
  i.verified[0]!.source_url = "https://www.cpsc.gov/notice";
  i.check.claims[0]!.quote = "lithium battery products including lamps must carry the warning label under the standard";
  i.verified[0]!.quote = i.check.claims[0]!.quote;
  const r = auditRuleCheck(i);
  assert.equal(r.check.impact.tariff_rate_change_pct, null);
  assert.equal(r.check.action.type, "review");
  assert.ok(r.issues.some((x) => x.code === "rate_on_non_tariff_rule"));
  assert.ok(r.issues.some((x) => x.code === "action_family_mismatch"));
});

test("claims quoted from off-domain pages are unbacked; losing all of them drops the alert", () => {
  const i = base();
  i.verified[0]!.matched_url = "https://randomblog.example/tariffs";
  const r = auditRuleCheck(i);
  assert.ok(r.drop);
  assert.ok(r.issues.some((x) => x.code === "off_domain_claim"));
});

test("implausible dates are dropped", () => {
  for (const d of ["2012-01-01", "2031-01-01", "not a date"]) {
    const i = base();
    i.check.impact.effective_date = d;
    const r = auditRuleCheck(i);
    assert.equal(r.check.impact.effective_date, null, d);
  }
  assert.equal(auditRuleCheck(base()).check.impact.effective_date, "2026-01-01");
});

test("an alert about a different product on the same official site is dropped", () => {
  const i = base();
  const q = "infant cribs sold after this date must meet the updated crib standard and carry a tracking label";
  i.check.headline = "New crib standard takes effect";
  i.check.claims = [{ claim: "Crib standard updated", quote: q, source_url: "https://ustr.gov/x" }];
  i.verified = [{ claim: "Crib standard updated", quote: q, source_url: "https://ustr.gov/x", backed: true, matched_url: "https://ustr.gov/x" }];
  i.check.impact = { severity: "medium", effective_date: null, tariff_rate_change_pct: null, estimated_cost_change_pct: null, nexus: null };
  i.check.action.type = "review";
  const r = auditRuleCheck(i);
  assert.ok(r.drop);
  assert.ok(r.issues.some((x) => x.code === "off_topic"));
});

test("a repeat of a recent alert for the same rule is dropped", () => {
  const i = base({ previous: [{ headline: "Section 301 duty on lamps from China rises from 25% to 37.5% on January 1, 2026", created_at: "2026-10-01T00:00:00Z", impact: { tariff_rate_change_pct: 12.5, estimated_cost_change_pct: null, effective_date: "2026-01-01" } }] });
  const r = auditRuleCheck(i);
  assert.ok(r.drop);
  assert.ok(r.issues.some((x) => x.code === "duplicate_of_previous"));
  // but the same finding from long ago is news again
  const old = auditRuleCheck(base({ previous: [{ ...i.previous[0]!, created_at: "2025-01-01T00:00:00Z" }] }));
  assert.equal(old.drop, false);
});

test("severity follows the numbers", () => {
  const i = base();
  i.check.impact.tariff_rate_change_pct = 2;
  i.check.claims[0]!.quote = "the duty rises by 2 percent";
  i.verified[0]!.quote = "the duty rises by 2 percent";
  const r = auditRuleCheck(i);
  assert.equal(r.check.impact.severity, "medium");
  const j = base();
  j.check.impact.severity = "low";
  assert.equal(auditRuleCheck(j).check.impact.severity, "medium");
});

test("history context lists prior alerts and the price trend", () => {
  const h = historyContext(
    [{ headline: "Old alert", created_at: "2026-09-01T00:00:00Z", impact: { tariff_rate_change_pct: 7.5, estimated_cost_change_pct: null, effective_date: "2026-09-15" } }],
    [{ at: "2026-08-01T00:00:00Z", price: 29.99 }, { at: "2026-10-01T00:00:00Z", price: 31.5 }],
    "2026-10-29",
  );
  assert.match(h, /Old alert, \+7\.5 pts, effective 2026-09-15/);
  assert.match(h, /29\.99 on 2026-08-01 to 31\.50 on 2026-10-01 \(\+5\.0%/);
});

test("a notice about another heading and origin is dropped even on the right official site", () => {
  const i = base();
  const q = "Effective November 1, 2025, footwear of heading 6404 that is the product of Vietnam is subject to an additional duty of 20 percent ad valorem";
  i.check.headline = "New 20% duty on products from Vietnam takes effect November 1";
  i.check.claims = [{ claim: "20 percent duty", quote: q, source_url: "https://ustr.gov/x" }];
  i.verified = [{ claim: "20 percent duty", quote: q, source_url: "https://ustr.gov/x", backed: true, matched_url: "https://ustr.gov/x" }];
  i.check.impact = { severity: "high", effective_date: "2025-11-01", tariff_rate_change_pct: 20, estimated_cost_change_pct: null, nexus: null };
  const r = auditRuleCheck(i);
  assert.ok(r.drop);
  assert.ok(r.issues.some((x) => x.code === "off_topic" && /6404|Vietnam/.test(x.message)));
  assert.deepEqual(headingsIn("heading 6404 and heading 6403, also 9405.20.60"), ["6404", "6403", "9405"]);
});

test("a generic rule-subject match without the product is not enough when the rule names the product", () => {
  const i = base({ rule: { ...tariffRule, family: "safety", title: "ASTM F963 toy safety standard (CPSC)", query: "CPSC ASTM F963 toy safety standard", include_domains: ["cpsc.gov"] } });
  const q = "Full-size cribs manufactured after March 1, 2026 must meet the updated mattress support and slat strength requirements";
  i.check.headline = "Updated crib standard takes effect March 1, 2026";
  i.check.relevance = "might_affect";
  i.check.claims = [{ claim: "Crib standard", quote: q, source_url: "https://www.cpsc.gov/x" }];
  i.verified = [{ claim: "Crib standard", quote: q, source_url: "https://www.cpsc.gov/x", backed: true, matched_url: "https://www.cpsc.gov/x" }];
  i.check.impact = { severity: "medium", effective_date: "2026-03-01", tariff_rate_change_pct: null, estimated_cost_change_pct: null, nexus: null };
  i.check.action.type = "review";
  i.product = { ...lamp, profile: { ...lamp.profile, category: "Toys", product_type: "stacking toy", keywords: ["wooden toy", "stacking toy", "toddler toy"], materials: ["beech wood"], hts_candidates: [{ code: "9503", description: "Toys, scale models, puzzles" }] } };
  const r = auditRuleCheck(i);
  assert.ok(r.drop, JSON.stringify(r.issues));
});

test("a new level reported as the change is corrected to the difference of the two levels", () => {
  assert.equal(impliedChangeFromLevels("modified from 7.5 percent to 25 percent ad valorem"), 17.5);
  assert.equal(impliedChangeFromLevels("rises from 25% to 37.5%"), 12.5);
  assert.equal(impliedChangeFromLevels("an additional 25% duty"), null);
  const i = base();
  const q = "the additional duty rate is modified from 7.5 percent to 25 percent ad valorem for goods entered on or after June 1, 2026";
  i.check.claims[0]!.quote = q;
  i.verified[0]!.quote = q;
  i.check.impact.tariff_rate_change_pct = 25;
  const r = auditRuleCheck(i);
  assert.equal(r.check.impact.tariff_rate_change_pct, 17.5);
  assert.ok(r.issues.some((x) => x.code === "rate_corrected_from_levels"));
  assert.equal(r.check.action.type, "reprice");
});

test("a universal tariff with no heading or country named is kept as unconfirmed", () => {
  const i = base();
  const q = "a universal additional duty of 10 percent ad valorem applies to all imported merchandise entered on or after April 5, 2026";
  i.check.headline = "A 10% duty applies to all imports from April 5, 2026";
  i.check.claims[0]!.quote = q;
  i.verified[0]!.quote = q;
  i.check.impact = { severity: "high", effective_date: "2026-04-05", tariff_rate_change_pct: 10, estimated_cost_change_pct: null, nexus: null };
  const r = auditRuleCheck(i);
  assert.equal(r.drop, false);
  assert.equal(r.check.relevance, "might_affect");
  assert.equal(r.check.impact.tariff_rate_change_pct, 10);
});

test("a short rate quote is read with its surrounding source sentence for the subject check", () => {
  const text = "Notice of Modification. For products of China classified under heading 9405 (lamps and lighting fittings), the additional duty will increase from 25 percent to 37.5 percent ad valorem effective January 1, 2026. Importers should file accordingly.";
  const q = "the additional duty will increase from 25 percent to 37.5 percent ad valorem effective January 1, 2026";
  assert.match(quoteContext(q, [{ url: "https://ustr.gov/n", text }]), /heading 9405/);
  const i = base({ sources: [{ url: "https://ustr.gov/notice", text }] });
  i.check.claims[0]!.quote = q;
  i.verified[0]!.quote = q;
  i.verified[0]!.matched_url = "https://ustr.gov/notice";
  const r = auditRuleCheck(i);
  assert.equal(r.drop, false);
  assert.equal(r.check.relevance, "affects", JSON.stringify(r.issues));
});

test("exclusion sentences do not make a product the subject", () => {
  const t = "Cribs made after March 1, 2026 must meet F1169-25. This rule applies to full-size cribs only and does not change requirements for toys, play yards, or bassinets. Footwear of heading 6403 is not affected.";
  const out = stripNegatedClauses(t);
  assert.match(out, /Cribs made after/);
  assert.doesNotMatch(out, /toys/);
  assert.doesNotMatch(out, /6403/);
});
