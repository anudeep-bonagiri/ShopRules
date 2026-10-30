// Mounts the real Panel on a fixture page with a fake background worker, so the
// HUD can be screenshotted (and eyeballed) without loading the extension in
// Chrome. Data mirrors the demo lamp: one open Section 301 alert with a stored
// PricingResult, ten rules, a month of price points.
import { Panel } from "../src/panel";
import { reprice } from "../../apps/web/src/lib/pricing";
import type { Alert, BgRequest, BgResult, PageProduct, Product, Rule, RunRecord } from "../src/types";

declare global {
  interface Window {
    __srHud: { open: (mode: "unwatched" | "watched" | "checking" | "price") => void; panel: Panel };
  }
}

const now = Date.now();
const day = 86_400_000;
const iso = (d: number) => new Date(now - d * day).toISOString();

const product: Product = {
  id: "prod_lamp",
  account_id: "acct",
  url: "https://www.amazon.com/dp/B0CXK7L9QZ",
  marketplace: "amazon",
  title: "USB-C Rechargeable LED Desk Lamp with Lithium Battery, 3 Color Modes, Foldable",
  price: 29.99,
  currency: "USD",
  image_url: null,
  profile: {
    title: "USB-C Rechargeable LED Desk Lamp",
    brand: "Lumenex",
    price: 29.99,
    currency: "USD",
    category: "Lighting",
    product_type: "desk lamp",
    materials: ["aluminum alloy", "abs plastic", "lithium-ion battery"],
    origin_country: "CN",
    intended_for_children: false,
    is_cosmetic: false,
    is_electronic: true,
    has_battery: true,
    is_textile: false,
    is_food_contact: false,
    is_supplement_or_food: false,
    hts_candidates: [{ code: "9405", description: "Lamps and lighting fittings", confidence: 0.82 }],
    hts_detail: "9405.20.60",
    keywords: ["desk lamp", "led lamp"],
    summary: "A portable LED desk lamp with a lithium battery, made in China.",
  },
  overrides: { unit_cost: 13.5 },
  created_at: iso(31),
  last_checked_at: iso(1),
  open_alerts: 1,
};

const ruleDefs: Array<[Rule["family"], string, string, number]> = [
  ["tariff", "Tariffs on desk lamp from China", "cbp.gov", 12],
  ["tariff", "Section 301 action on desk lamp", "ustr.gov", 12],
  ["tariff", "Duty rate for HTS 9405", "hts.usitc.gov", 48],
  ["tariff", "De minimis treatment of low-value imports", "cbp.gov", 24],
  ["safety", "Lithium battery safety for desk lamp (CPSC)", "cpsc.gov", 24],
  ["safety", "California Proposition 65 warnings", "oehha.ca.gov", 72],
  ["tax", "Texas economic nexus threshold", "comptroller.texas.gov", 72],
  ["tax", "California economic nexus threshold", "cdtfa.ca.gov", 72],
  ["tax", "New York economic nexus threshold", "tax.ny.gov", 72],
  ["policy", "Amazon policy for Lighting", "sellercentral.amazon.com", 48],
];
const rules: Rule[] = ruleDefs.map(([family, title, domain, cadence], i) => ({
  id: `rule_${i}`,
  product_id: product.id,
  family,
  key: `k${i}`,
  title,
  query: title,
  include_domains: [domain],
  cadence_hours: cadence,
  state: family === "tax" ? ["TX", "CA", "NY"][i - 6] ?? null : null,
  seed_note: null,
  last_run_at: i === 8 ? null : iso(i === 1 ? 1 : 2 + (i % 3)),
  last_hash: null,
}));

const pricing = reprice({ price: 29.99, landed_cost: 13.5, dutiable_share: 0.85, duty_rate_change_pts: 12.5, est_cost_change_pct: null, units_per_week: 20, target_margin_pct: 35, rounding: 0.5 });
const alert: Alert = {
  id: "alert_301",
  product_id: product.id,
  rule_id: "rule_1",
  status: "new",
  family: "tariff",
  severity: "high",
  headline: "Section 301 duty on lamps from China rises from 25% to 37.5% on January 1, 2026",
  relevance: "affects",
  claims: [
    { claim: "The additional duty on heading 9405 rises 12.5 points", quote: "the additional duty will increase from 25 percent to 37.5 percent ad valorem effective January 1, 2026", source_url: "https://ustr.gov/notice", backed: true, matched_url: "https://ustr.gov/notice" },
    { claim: "Exclusion requests close March 31, 2026", quote: "Requests for exclusions may be submitted through the exclusion portal through March 31, 2026", source_url: "https://ustr.gov/notice", backed: true, matched_url: "https://ustr.gov/notice" },
    { claim: "Lamps of heading 8513 are also covered", quote: "portable lamps of heading 8513 are covered by this action", source_url: "https://ustr.gov/notice", backed: false, matched_url: null },
  ],
  proposed: 3,
  backed: 2,
  rejected: 1,
  impact: { severity: "high", effective_date: "2026-01-01", tariff_rate_change_pct: 12.5, estimated_cost_change_pct: null },
  action: { type: "reprice", title: "Reprice before January 1 or absorb 12.5 points of duty", steps: ["Confirm the lamp enters under heading 9405", "Raise the listing price", "Ask the supplier about a Vietnam alternative"], suggested_price: pricing.suggested_price, rationale: "" },
  pricing,
  sources: [{ url: "https://ustr.gov/notice", title: "USTR Modifies Section 301 Action: Lighting Products", domain: "ustr.gov" }],
  created_at: iso(1),
};

const priceAlert: Alert = {
  ...alert,
  id: "alert_price",
  rule_id: `price:${product.id}`,
  family: "policy",
  kind: "price",
  severity: "medium",
  headline: "USB-C Rechargeable LED Desk Lamp with Lithium Battery... is now $27.49, down 8.3% from $29.99",
  claims: [],
  proposed: 0,
  backed: 0,
  rejected: 0,
  impact: { severity: "medium", effective_date: null, tariff_rate_change_pct: null, estimated_cost_change_pct: null },
  action: { type: "review", title: "Check why the price dropped", steps: ["Check whether a sale or coupon is running"], suggested_price: null, rationale: "" },
  pricing: reprice({ price: 27.49, landed_cost: 13.5, dutiable_share: 0.85, duty_rate_change_pts: null, est_cost_change_pct: null, units_per_week: 20, target_margin_pct: 35, rounding: 0.5 }),
  price_change: { old_price: 29.99, new_price: 27.49, delta: -2.5, pct: -8.3 },
  created_at: iso(0),
};

const history = [
  { at: iso(31), price: 31.99, currency: "USD", source: "listing" },
  { at: iso(27), price: 31.99, currency: "USD", source: "refresh" },
  { at: iso(22), price: 29.99, currency: "USD", source: "refresh" },
  { at: iso(18), price: 29.99, currency: "USD", source: "extension" },
  { at: iso(12), price: 28.49, currency: "USD", source: "refresh" },
  { at: iso(8), price: 29.99, currency: "USD", source: "extension" },
  { at: iso(3), price: 29.99, currency: "USD", source: "refresh" },
  { at: iso(0), price: 29.99, currency: "USD", source: "extension" },
];

let mode: "unwatched" | "watched" | "checking" | "price" = "watched";
let checkStarted = 0;

function runRecord(): RunRecord {
  const elapsed = (Date.now() - checkStarted) / 1000;
  const due = rules.filter((r) => !r.last_run_at || r.cadence_hours <= 24);
  const done = Math.min(due.length, Math.floor(elapsed / 1.2));
  const items = due.map((r, i) => ({ rule_id: r.id, title: r.title, family: r.family, domain: r.include_domains[0] ?? "", status: i < done ? ("clear" as const) : i < done + 3 ? ("checking" as const) : ("queued" as const) }));
  return { id: "run_1", kind: "check", status: done >= due.length ? "done" : "running", total: due.length, done, current: items.filter((i) => i.status === "checking").map((i) => i.domain), items };
}

async function fakeSend<T>(message: BgRequest): Promise<BgResult<T>> {
  const ok = (data: unknown) => ({ ok: true as const, data: data as T });
  switch (message.type) {
    case "settings":
      return ok({ baseUrl: "https://shop-rules.vercel.app", token: "sr_live_demo" });
    case "account":
      return ok({ account: { id: "acct", token: "sr_live_demo", telegram_configured: false, settings: { target_margin_pct: 35, unit_cost_pct: 45, units_per_week: 20, currency: "USD", price_change_pct: 3 } } });
    case "lookup":
      return ok({ watched: mode !== "unwatched", product: mode === "unwatched" ? null : product, marketplace: "amazon", families_preview: ["tariff", "safety", "tax", "policy"] });
    case "product":
      return ok({ product, rules, alerts: mode === "price" ? [priceAlert, alert] : [alert], price_history: mode === "price" ? [...history, { at: iso(0), price: 27.49, currency: "USD", source: "extension" }] : history, skills: [] });
    case "check": {
      checkStarted = Date.now();
      await new Promise((r) => setTimeout(r, 60_000));
      return ok({ alerts: [], checked: 5, skipped_unchanged: 4, errors: [], run_id: "run_1" });
    }
    case "run":
      return ok({ run: runRecord() });
    case "compare":
      await new Promise((r) => setTimeout(r, 400));
      return ok({
        listings: [
          { title: "LED Desk Lamp with Wireless Charger, Dimmable", marketplace: "amazon", price: 34.99, currency: "USD", url: "https://www.amazon.com/dp/B0OTHER001", seller: null },
          { title: "Rechargeable Desk Lamp, Foldable, 3 Modes", marketplace: "walmart", price: 24.97, currency: "USD", url: "https://www.walmart.com/ip/1", seller: null },
          { title: "Cordless LED Table Lamp, USB-C", marketplace: "amazon", price: 31.5, currency: "USD", url: "https://www.amazon.com/dp/B0OTHER002", seller: null },
        ],
        price_position: "at_market",
        note: "Median competitor price 31.50; this listing is 1.51 below it.",
        cached: true,
        cached_at: iso(0.2),
      });
    default:
      return ok({ ok: true });
  }
}

const page: PageProduct = {
  url: product.url,
  title: product.title,
  price: mode === "price" ? 27.49 : 29.99,
  currency: "USD",
  description: null,
  materials: ["aluminum alloy", "abs plastic"],
  image: null,
  confidence: { title: "selectors", price: "selectors", materials: "selectors" },
};

const panel = new Panel(fakeSend, () => undefined);
window.__srHud = {
  panel,
  open(m) {
    mode = m;
    panel.open({ ...page, price: m === "price" ? 27.49 : 29.99 }, "amazon");
  },
};
