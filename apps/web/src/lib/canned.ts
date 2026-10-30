// Canned Nemotron answers and canned Tavily results for offline mode. The
// fixtures are the golden eval cases (realistic official excerpts with known
// answers), so a demo shop seeded offline produces alerts that go through the
// real verifier, guardrails, and pricing. Nothing here is used when keys are set.
import type { ZodTypeAny, z } from "zod";
import cases from "./fixtures/eval-cases.json";
import { keywordMatches } from "./hts-catalog";
import type { Meter } from "./schemas";
import type { TavilyExtractResponse, TavilySearchParams, TavilySearchResponse } from "./tavily";

type Fixture = typeof cases;
type Case = Fixture["cases"][number];

const COUNTRY_CODES: Record<string, string> = { china: "CN", vietnam: "VN", india: "IN", mexico: "MX", canada: "CA", "united states": "US", usa: "US", "u.s.a": "US", italy: "IT", germany: "DE", japan: "JP", korea: "KR", "south korea": "KR", thailand: "TH", indonesia: "ID", bangladesh: "BD", turkey: "TR", portugal: "PT", "united kingdom": "GB", uk: "GB", taiwan: "TW", cambodia: "KH", pakistan: "PK", malaysia: "MY", philippines: "PH" };

function line(text: string, label: string): string | null {
  const m = text.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"));
  return m ? m[1].trim() : null;
}

function tokenSet(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length >= 3));
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// --- Nemotron

function cannedProfile(user: string): unknown {
  const marketplace = line(user, "Marketplace") ?? "other";
  const body = user.split(/Listing text:\s*/i)[1] ?? user;
  const title = line(body, "Title") ?? body.split("\n").find((l) => l.trim())?.trim() ?? "Untitled listing";
  const priceLine = line(body, "Price");
  const price = priceLine ? Number(priceLine.split(/\s+/)[0]) : null;
  const currency = priceLine?.split(/\s+/)[1] ?? (price != null ? "USD" : null);
  const materials = (line(body, "Materials") ?? "").split(/[,;]/).map((m) => m.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  const originMatch = body.match(/\b(?:made in|country of origin:?|cut and sewn in|manufactured in|product of)\s+([A-Za-z. ]{2,20}?)(?=[,.;\n]|\s+(?:and|shipped|ships|dyed|finished)\b)/i);
  const originName = originMatch?.[1]?.trim().toLowerCase() ?? null;
  const origin_country = originName ? (COUNTRY_CODES[originName] ?? null) : null;
  const matches = keywordMatches(title, body, 3);
  const top = matches[0];
  const lower = `${title} ${body}`.toLowerCase();
  const children = /\b(toddler|toddlers|kids|children|child|baby|infant|montessori|ages? \d|months and up)\b/.test(lower);
  return {
    title: title.slice(0, 200),
    brand: line(body, "Brand"),
    price: Number.isFinite(price) ? price : null,
    currency,
    category: top?.heading.label.split(",")[0] ?? "General merchandise",
    product_type: top?.hits[0] ?? title.split(",")[0].toLowerCase().slice(0, 60),
    materials,
    origin_country,
    intended_for_children: children,
    is_cosmetic: /\b(skincare|serum|lotion|lip balm|cosmetic|soap|shampoo)\b/.test(lower),
    is_electronic: /\b(usb|led|battery|charger|electric|electronic|bluetooth)\b/.test(lower),
    has_battery: /\bbatter(y|ies)\b/.test(lower),
    is_textile: /\b(cotton|linen|wool|polyester|tee|t-shirt|shirt|garment|fabric|textile)\b/.test(lower),
    is_food_contact: /\b(mug|cup|plate|bowl|cutting board|utensil|bottle)\b/.test(lower),
    is_supplement_or_food: /\b(tea|coffee|chocolate|supplement|vitamin|snack)\b/.test(lower),
    hts_heading: top?.heading.heading ?? "3926",
    hts_alternatives: matches.slice(1, 3).map((m) => m.heading.heading),
    hts_confidence: top ? Math.min(0.9, 0.5 + top.score / 20) : 0.3,
    hts_detail: null,
    keywords: Array.from(new Set(matches.flatMap((m) => m.hits))).slice(0, 8),
    summary: `${title}. Classified offline from the listing text; set NEBIUS_API_KEY for a Nemotron classification.`,
  };
}

function cannedRuleCheck(user: string): unknown {
  const hit = cases.cases
    .map((c) => ({ c, n: c.sources.filter((s) => user.includes(s.url)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)[0];
  if (hit) return { ...hit.c.simulated, impact: { nexus: null, ...hit.c.simulated.impact } };
  return {
    relevance: "no_change",
    headline: "No change found in the sources for this product",
    claims: [],
    impact: { severity: "low", effective_date: null, tariff_rate_change_pct: null, estimated_cost_change_pct: null, nexus: null },
    action: { type: "none", title: "Nothing to do", steps: [], rationale: "Offline mode: no recorded source matched this rule." },
  };
}

function cannedCompare(user: string): unknown {
  const title = (user.match(/PRODUCT:\s*(.+)/)?.[1] ?? "product").replace(/\(sold on .*?\)/, "").trim();
  const base = 30;
  const mk = (marketplace: string, factor: number, seller: string | null) => ({ title: `${title.slice(0, 50)} (${marketplace})`, marketplace, price: Math.round(base * factor * 100) / 100, currency: "USD", url: `https://www.${marketplace}.com/offline-fixture`, seller });
  return { listings: [mk("amazon", 0.93, "Brightline Home"), mk("etsy", 1.12, "lumenworks"), mk("walmart", 0.89, null), mk("ebay", 1.05, "deskgear")], price_position: "unknown", note: "Offline fixture: four comparable listings with placeholder prices." };
}

function cannedSkill(user: string): unknown {
  const reason = (user.match(/Seller's reason:\s*(.+)/)?.[1] ?? "this does not apply").trim();
  return { skill: `Do not raise this again when ${reason.slice(0, 120).replace(/\.$/, "")}.`, scope: "product" };
}

export function cannedChatJSON<S extends ZodTypeAny>(tier: string, opts: { name: string; user: string; schema: S; purpose: string }, meter?: Meter): z.infer<S> {
  let out: unknown;
  switch (opts.name) {
    case "product_profile":
      out = cannedProfile(opts.user);
      break;
    case "rule_check":
      out = cannedRuleCheck(opts.user);
      break;
    case "competitor_listings":
      out = cannedCompare(opts.user);
      break;
    case "skill":
      out = cannedSkill(opts.user);
      break;
    default:
      throw new Error(`Offline mode has no canned answer for "${opts.name}". Set NEBIUS_API_KEY to use Nemotron on Nebius.`);
  }
  if (meter) meter.llm.push({ tier: tier as "nano" | "super" | "ultra", model: "canned (offline mode)", prompt_tokens: 0, completion_tokens: 0, ms: 1, cost_usd: 0, purpose: `${opts.purpose} (canned)` });
  const parsed = opts.schema.safeParse(out);
  if (!parsed.success) throw new Error(`Canned answer for ${opts.name} failed the schema: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  return parsed.data;
}

// --- Tavily

function inDomains(url: string, domains: string[] | undefined): boolean {
  if (!domains?.length) return true;
  const host = hostOf(url);
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export function cannedSearch(params: TavilySearchParams, meter?: Meter): TavilySearchResponse {
  if (meter) meter.tavily_calls += 1;
  const q = tokenSet(params.query);
  const scored = cases.cases
    .map((c: Case) => {
      const productTokens = tokenSet(cases.products[c.product as keyof typeof cases.products].title);
      const productHit = overlap(q, productTokens);
      const ruleHit = overlap(q, tokenSet(`${c.rule.title} ${c.rule.query}`));
      return { c, score: productHit > 0 ? productHit + ruleHit : 0 };
    })
    .filter((x) => x.score >= 3 && x.c.sources.some((s) => inDomains(s.url, params.include_domains)))
    .sort((a, b) => b.score - a.score);
  const results = scored.slice(0, 2).flatMap((x) =>
    x.c.sources
      .filter((s) => inDomains(s.url, params.include_domains))
      .map((s) => ({ title: s.title, url: s.url, content: s.text.slice(0, 600), score: Math.min(0.98, 0.6 + x.score / 20), published_date: s.published_date })),
  );
  return { query: params.query, results, response_time: 0.01 };
}

export function cannedExtract(urls: string[], meter?: Meter): TavilyExtractResponse {
  if (meter) meter.tavily_calls += 1;
  const known = new Map<string, { title: string; text: string }>();
  for (const c of cases.cases) for (const s of c.sources) known.set(s.url, { title: s.title, text: s.text });
  const results: TavilyExtractResponse["results"] = [];
  const failed: TavilyExtractResponse["failed_results"] = [];
  for (const u of urls) {
    const k = known.get(u);
    if (k) results.push({ url: u, raw_content: k.text, title: k.title });
    else failed.push({ url: u, error: "offline mode: live pages are not fetched" });
  }
  return { results, failed_results: failed, response_time: 0.01 };
}
