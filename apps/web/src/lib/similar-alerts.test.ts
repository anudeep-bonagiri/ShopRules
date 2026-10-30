import { test } from "node:test";
import assert from "node:assert/strict";
import { similarAlerts, type SimilarCandidate } from "./similar-alerts.ts";

const rules = new Map([
  ["r-tx", "tax-TX"],
  ["r-ca", "tax-CA"],
  ["r-fl", "tax-FL"],
  ["r-cpsc", "safety-cpsc-children"],
  ["r-dem1", "tariff-deminimis"],
  ["r-dem2", "tariff-deminimis"],
]);
const a = (id: string, product: string, rule: string, family: string, headline: string, extra: Partial<SimilarCandidate> = {}): SimilarCandidate => ({ id, product_id: product, rule_id: rule, family, status: "new", headline, product_title: `P ${product}`, ...extra });

test("an account-wide nexus dismissal offers the other open nexus states", () => {
  const fl = a("1", "p1", "r-fl", "tax", "Florida nexus threshold is 100,000 dollars");
  const open = [fl, a("2", "p1", "r-tx", "tax", "Texas nexus threshold is 500,000 dollars"), a("3", "p2", "r-ca", "tax", "California threshold"), a("4", "p1", "r-cpsc", "safety", "CPSC coin battery rule")];
  const sim = similarAlerts(fl, open, rules, "account");
  assert.deepEqual(sim.map((s) => s.id), ["2", "3"]);
});

test("a product-scoped reason stays on that product", () => {
  const fl = a("1", "p1", "r-fl", "tax", "Florida nexus threshold");
  const open = [fl, a("2", "p1", "r-tx", "tax", "Texas nexus threshold"), a("3", "p2", "r-ca", "tax", "California threshold")];
  assert.deepEqual(similarAlerts(fl, open, rules, "product").map((s) => s.id), ["2"]);
});

test("same rule key across products, price alerts and other families are never siblings", () => {
  const d1 = a("1", "p1", "r-dem1", "tariff", "De minimis ends for low value imports");
  const open = [d1, a("2", "p2", "r-dem2", "tariff", "De minimis treatment ends August 29"), a("3", "p2", "r-cpsc", "safety", "CPSC"), a("4", "p2", "r-dem2", "policy", "Price moved", { kind: "price" })];
  assert.deepEqual(similarAlerts(d1, open, rules, "family").map((s) => s.id), ["2"]);
});
