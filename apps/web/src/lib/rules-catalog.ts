import type { Marketplace, ProductProfile, RuleFamily } from "./schemas";
import { NEXUS_SEEDS, describeThreshold } from "./nexus";

// The catalog seeds watch rules for a product. Every threshold and source here
// is a starting point that the watch loop verifies against the live official
// page through Tavily. Nothing in an alert is hard-coded from this file.

export interface RuleSpec {
  family: RuleFamily;
  key: string;
  title: string;
  query: string;
  include_domains: string[];
  include_domains_mode: "strict" | "prefer";
  cadence_hours: number;
  state: string | null;
  seed_note: string | null;
}

export interface StateTaxSeed {
  code: string;
  name: string;
  dor_domain: string;
  threshold_note: string;
}

// Economic nexus seeds for remote sellers. Marketplace facilitator laws mean
// Amazon and Etsy collect for you in every one of these states; Shopify sellers
// register themselves once they cross the threshold.
// Derived from nexus-thresholds.json (seed values; the live check verifies them).
export const STATES: StateTaxSeed[] = NEXUS_SEEDS.map((n) => ({
  code: n.state,
  name: n.name,
  dor_domain: n.dor_domain,
  threshold_note: `${describeThreshold(n)} ${n.period === "12_months" ? "over the preceding 12 months" : "in the previous or current calendar year"}`,
}));

export const TARIFF_DOMAINS = ["cbp.gov", "ustr.gov", "federalregister.gov", "trade.gov", "hts.usitc.gov", "whitehouse.gov"];

export const COUNTRY_NAMES: Record<string, string> = {
  CN: "China",
  VN: "Vietnam",
  IN: "India",
  MX: "Mexico",
  CA: "Canada",
  US: "United States",
  TH: "Thailand",
  ID: "Indonesia",
  BD: "Bangladesh",
  TR: "Turkey",
  KR: "South Korea",
  JP: "Japan",
  TW: "Taiwan",
  DE: "Germany",
  IT: "Italy",
  GB: "United Kingdom",
  PK: "Pakistan",
  PH: "Philippines",
  MY: "Malaysia",
  BR: "Brazil",
};

export function countryName(code: string | null): string {
  if (!code) return "imported";
  return COUNTRY_NAMES[code.toUpperCase()] ?? code;
}

export function marketplaceFromUrl(url: string): Marketplace {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host.includes("amazon.")) return "amazon";
  if (host.includes("etsy.com")) return "etsy";
  if (host.includes("shopify") || host.includes("myshopify.com")) return "shopify";
  return "other";
}

export const MARKETPLACE_POLICY_DOMAINS: Record<Marketplace, string[]> = {
  amazon: ["sellercentral.amazon.com", "amazon.com"],
  etsy: ["help.etsy.com", "etsy.com"],
  shopify: ["help.shopify.com", "shopify.com"],
  other: ["help.shopify.com", "help.etsy.com", "sellercentral.amazon.com"],
};

export function buildRules(profile: ProductProfile, marketplace: Marketplace, shipToStates: string[]): RuleSpec[] {
  const year = new Date().getFullYear();
  const origin = countryName(profile.origin_country);
  const type = profile.product_type || profile.category;
  const rules: RuleSpec[] = [];

  // Tariffs and duties. Watched for every imported product; a product made in
  // the United States pays no import duty, so no tariff rule is seeded for it
  // (the product page says so in its duty exposure card).
  const domestic = profile.origin_country?.toUpperCase() === "US";
  if (!domestic) rules.push({
    family: "tariff",
    key: "tariff-origin",
    title: profile.origin_country ? `Tariffs on ${type} from ${origin}` : `Tariffs on ${type} from unknown origin, set it to sharpen tariff checks`,
    query: profile.origin_country ? `${origin} ${type} tariff duty rate change ${year}` : `${type} import tariff duty rate change ${year}`,
    include_domains: TARIFF_DOMAINS,
    include_domains_mode: "strict",
    cadence_hours: 12,
    state: null,
    seed_note: null,
  });
  if (profile.origin_country && profile.origin_country.toUpperCase() === "CN") {
    rules.push({
      family: "tariff",
      key: "tariff-301",
      title: `Section 301 action on ${type}`,
      query: `Section 301 China tariff ${type} ${profile.hts_candidates[0]?.code ?? ""} ${year}`.trim(),
      include_domains: ["ustr.gov", "federalregister.gov", "cbp.gov"],
      include_domains_mode: "strict",
      cadence_hours: 12,
      state: null,
      seed_note: null,
    });
  }
  if (!domestic) rules.push({
    family: "tariff",
    key: "tariff-deminimis",
    title: "De minimis treatment of low-value imports",
    query: `de minimis exemption low value shipments ${origin} CBP ${year}`,
    include_domains: ["cbp.gov", "federalregister.gov", "whitehouse.gov"],
    include_domains_mode: "strict",
    cadence_hours: 24,
    state: null,
    seed_note: null,
  });
  const hts = profile.hts_candidates[0];
  if (hts?.code && !domestic) {
    rules.push({
      family: "tariff",
      key: "tariff-hts",
      title: `Duty rate for HTS ${hts.code}`,
      query: `HTS ${hts.code} ${hts.description} general duty rate ${year}`,
      include_domains: ["hts.usitc.gov", "cbp.gov", "rulings.cbp.gov"],
      include_domains_mode: "strict",
      cadence_hours: 48,
      state: null,
      seed_note: `Classifier picked ${hts.code} (${Math.round(hts.confidence * 100)}% confidence). Confirm with a broker before relying on it.`,
    });
  }

  // Product safety, by what the product is.
  if (profile.intended_for_children) {
    rules.push({
      family: "safety",
      key: "safety-cpsc-children",
      title: `CPSC rules for children's ${type}`,
      query: `CPSC children's product ${type} rule recall lead phthalates small parts ${year}`,
      include_domains: ["cpsc.gov"],
      include_domains_mode: "strict",
      cadence_hours: 12,
      state: null,
      seed_note: "Children's products need a Children's Product Certificate backed by third-party lab testing (CPSIA).",
    });
    rules.push({
      family: "safety",
      key: "safety-astm-f963",
      title: "ASTM F963 toy safety standard",
      query: `ASTM F963 toy safety standard update ${year} CPSC`,
      include_domains: ["cpsc.gov", "federalregister.gov"],
      include_domains_mode: "strict",
      cadence_hours: 48,
      state: null,
      seed_note: null,
    });
  }
  if (profile.is_cosmetic) {
    rules.push({
      family: "safety",
      key: "safety-mocra",
      title: "FDA cosmetic rules (MoCRA)",
      query: `FDA MoCRA cosmetic facility registration product listing requirement ${year}`,
      include_domains: ["fda.gov", "federalregister.gov"],
      include_domains_mode: "strict",
      cadence_hours: 24,
      state: null,
      seed_note: "MoCRA requires facility registration and product listing for most cosmetics sold in the US.",
    });
  }
  if (profile.is_electronic || profile.has_battery) {
    rules.push({
      family: "safety",
      key: "safety-battery",
      title: `Battery and electrical safety for ${type}`,
      query: `${type} lithium battery safety rule recall CPSC ${year}`,
      include_domains: ["cpsc.gov", "fcc.gov", "federalregister.gov"],
      include_domains_mode: "prefer",
      cadence_hours: 24,
      state: null,
      seed_note: null,
    });
  }
  if (profile.is_textile) {
    rules.push({
      family: "safety",
      key: "safety-textile-labeling",
      title: "FTC textile labeling and PFAS restrictions",
      query: `FTC textile fiber labeling care labeling rule ${year} PFAS textiles ban state law`,
      include_domains: ["ftc.gov", "federalregister.gov"],
      include_domains_mode: "prefer",
      cadence_hours: 48,
      state: null,
      seed_note: "Textiles need fiber content, country of origin, and care labels. Several states restrict intentionally added PFAS in apparel.",
    });
  }
  if (profile.is_food_contact || profile.is_supplement_or_food) {
    rules.push({
      family: "safety",
      key: "safety-fda-food",
      title: `FDA rules for ${type}`,
      query: `FDA ${type} ${profile.is_supplement_or_food ? "dietary supplement labeling" : "food contact substance"} rule ${year}`,
      include_domains: ["fda.gov", "federalregister.gov"],
      include_domains_mode: "strict",
      cadence_hours: 24,
      state: null,
      seed_note: null,
    });
  }
  rules.push({
    family: "safety",
    key: "safety-prop65",
    title: "California Proposition 65 warnings",
    query: `Proposition 65 ${type} ${profile.materials.slice(0, 3).join(" ")} listed chemical warning requirement ${year}`,
    include_domains: ["oehha.ca.gov", "p65warnings.ca.gov"],
    include_domains_mode: "strict",
    cadence_hours: 72,
    state: null,
    seed_note: "Any product sold into California needs a Prop 65 warning when it exposes users to a listed chemical.",
  });

  // State sales tax. Marketplace sellers are covered by facilitator laws;
  // Shopify sellers carry the registration themselves.
  const facilitatorCovered = marketplace === "amazon" || marketplace === "etsy";
  for (const code of shipToStates) {
    const st = STATES.find((s) => s.code === code);
    if (!st) continue;
    rules.push({
      family: "tax",
      key: `tax-${st.code}`,
      title: `${st.name} economic nexus threshold`,
      query: `${st.name} economic nexus threshold remote seller marketplace facilitator sales tax ${year}`,
      // Strict: a threshold is only ever quoted from the state revenue site, never from a tax consultancy.
      include_domains: [st.dor_domain],
      include_domains_mode: "strict",
      cadence_hours: 72,
      state: st.code,
      seed_note: facilitatorCovered
        ? `${marketplace === "amazon" ? "Amazon" : "Etsy"} collects as a marketplace facilitator here. Seed threshold: ${st.threshold_note}. Seed value until a check quotes the revenue site.`
        : `You register and collect once you cross the threshold. Seed threshold: ${st.threshold_note}. Seed value until a check quotes the revenue site.`,
    });
  }

  // Marketplace policy for this category.
  rules.push({
    family: "policy",
    key: "policy-marketplace",
    title: `${marketplace === "other" ? "Marketplace" : capitalize(marketplace)} policy for ${profile.category}`,
    query: `${capitalize(marketplace)} seller policy update ${profile.category} ${type} compliance requirement ${year}`,
    include_domains: MARKETPLACE_POLICY_DOMAINS[marketplace],
    include_domains_mode: "strict",
    cadence_hours: 48,
    state: null,
    seed_note: null,
  });

  return rules;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const FAMILY_LABEL: Record<RuleFamily, string> = {
  tariff: "Tariff",
  safety: "Product safety",
  tax: "Sales tax",
  policy: "Marketplace policy",
};
