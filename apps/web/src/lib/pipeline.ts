import { createHash } from "node:crypto";
import { ApiError } from "./account";
import {
  alertExistsForRuleHash,
  applyCheckBatch,
  insertProductBundle,
  insertRun,
  insertSkill,
  listRules,
  listSkills,
  newId,
  findProductByUrl,
  type AccountRow,
  type AlertRow,
  type ProductRow,
  type RuleRow,
  type SkillRow,
} from "./db";
import { chatJSON, costUsd, PRICES_PER_M } from "./nemotron";
import { buildRules, countryName, marketplaceFromUrl, type RuleSpec } from "./rules-catalog";
import {
  CompetitorListingsSchema,
  ProductProfileSchema,
  RuleCheckSchema,
  SkillSchema,
  newMeter,
  type CompetitorListings,
  type Meter,
  type ProductProfile,
} from "./schemas";
import { domainOf, tavilyExtract, tavilySearch, type TavilyResult } from "./tavily";
import { verifyClaims, type SourceText } from "./verifier";

export interface PageFields {
  title?: string;
  price?: number | null;
  currency?: string | null;
  description?: string;
  materials?: string[];
  image?: string | null;
  marketplace?: string | null;
}

export function normalizeListingUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ApiError(400, "That does not look like a listing URL.");
  }
  const host = u.hostname.toLowerCase();
  if (host.includes("amazon.")) {
    const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (m) return `https://${host.replace(/^www\./, "www.")}/dp/${m[1].toUpperCase()}`;
  }
  u.hash = "";
  const keep = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (k === "variant" || k === "listing_id") keep.set(k, v);
  u.search = keep.toString() ? `?${keep.toString()}` : "";
  return u.toString();
}

function safeNormalize(url: string): string | null {
  try {
    return normalizeListingUrl(url);
  } catch {
    return null;
  }
}

function allUltraCost(meter: Meter): number {
  return meter.llm.reduce((sum, c) => sum + (c.prompt_tokens * PRICES_PER_M.ultra.in + c.completion_tokens * PRICES_PER_M.ultra.out) / 1_000_000, 0);
}

function llmCost(meter: Meter): number {
  return meter.llm.reduce((sum, c) => sum + c.cost_usd, 0);
}

async function recordRun(account: AccountRow, productId: string | null, kind: string, meter: Meter): Promise<void> {
  try {
    await insertRun({
      account_id: account.id,
      product_id: productId,
      kind,
      tavily_calls: meter.tavily_calls,
      tavily_credits: meter.tavily_credits,
      llm: meter.llm,
      llm_cost_usd: llmCost(meter),
      all_ultra_cost_usd: allUltraCost(meter),
      duration_ms: Date.now() - meter.started_at,
    });
  } catch (err) {
    console.error("[shop-rules] run record failed", err);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// 1. Ingest a listing: Tavily Extract reads the page, Nemotron Nano classifies it,
//    the catalog seeds the watch rules.

export async function ingestProduct(account: AccountRow, rawUrl: string, page?: PageFields): Promise<{ product: ProductRow; rules: RuleRow[]; meter: Meter; existing: boolean }> {
  const url = normalizeListingUrl(rawUrl);
  const existing = await findProductByUrl(account.id, url);
  if (existing) return { product: existing, rules: await listRules(existing.id, account.id), meter: newMeter(), existing: true };

  const meter = newMeter();
  // The extension can see Shopify stores on custom domains that the URL alone does not reveal.
  const hinted = page?.marketplace && ["etsy", "shopify", "amazon"].includes(page.marketplace) ? (page.marketplace as "etsy" | "shopify" | "amazon") : null;
  const marketplace = hinted ?? marketplaceFromUrl(url);

  let extracted = "";
  let extractError: string | null = null;
  try {
    const ex = await tavilyExtract([url], { extract_depth: "advanced", format: "markdown" }, meter);
    extracted = ex.results[0]?.raw_content ?? "";
    if (!extracted && ex.failed_results?.[0]) extractError = ex.failed_results[0].error;
  } catch (err) {
    extractError = err instanceof Error ? err.message : String(err);
  }

  const pageText = [
    page?.title ? `Title: ${page.title}` : "",
    page?.price != null ? `Price: ${page.price} ${page.currency ?? ""}` : "",
    page?.materials?.length ? `Materials: ${page.materials.join(", ")}` : "",
    page?.description ? `Description: ${page.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const combined = `${pageText}\n\n${extracted}`.trim();
  if (combined.length < 40) {
    throw new ApiError(422, `Could not read that listing${extractError ? ` (${extractError})` : ""}. Add it from the extension, which sends the page fields along.`);
  }

  const profile = await chatJSON(
    "nano",
    {
      name: "product_profile",
      purpose: "classify listing",
      schema: ProductProfileSchema,
      system: [
        "You classify an e-commerce listing for a compliance and pricing watch service.",
        "Read the listing text and fill every field. Use null when the listing does not say.",
        "origin_country is the ISO 3166-1 alpha-2 code of where the product is made or ships from ONLY if the listing states it; otherwise null.",
        "hts_candidates: up to three plausible US Harmonized Tariff Schedule headings (4 to 6 digits, like 9503.00) with a confidence between 0 and 1.",
        "intended_for_children is true for toys, kids' clothing, nursery items, or anything marketed to under-12s.",
        "keywords: up to 8 short search terms a customs broker or safety regulator would use for this product type.",
        "summary: two plain sentences describing the product for a regulator.",
        "Return JSON only.",
      ].join(" "),
      user: `Marketplace: ${marketplace}\nURL: ${url}\n\nListing text:\n${combined.slice(0, 12000)}`,
      maxTokens: 1200,
    },
    meter,
  );

  const price = profile.price ?? page?.price ?? null;
  const currency = profile.currency ?? page?.currency ?? (price != null ? "USD" : null);
  const imageUrl = page?.image ?? firstImage(extracted);

  const states = account.settings?.ship_to_states?.length ? account.settings.ship_to_states : ["TX", "CA", "NY", "FL"];
  const specs: RuleSpec[] = buildRules(profile, marketplace, states);
  const bundle = await insertProductBundle(
    {
      account_id: account.id,
      url,
      marketplace,
      title: (page?.title || profile.title || "Untitled listing").slice(0, 200),
      price,
      currency,
      image_url: imageUrl,
      profile,
      extracted_text: combined.slice(0, 20000),
    },
    price != null ? { price, currency, source: page ? "extension" : "listing" } : null,
    specs,
  );
  await recordRun(account, bundle.product.id, "ingest", meter);
  return { product: bundle.product, rules: bundle.rules, meter, existing: bundle.existing };
}

// Model prose for the UI: no em or en dashes, single spaces.
function plain(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function firstImage(markdown: string): string | null {
  const m = markdown.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/);
  return m ? m[1] : null;
}

// 2. Run the watch rules for a product. Tavily Search on official domains, Tavily
//    Extract on the top pages, Nemotron Ultra decides and drafts, the verifier
//    drops any claim it cannot find in the extracted text. Rules run three at a
//    time and all bookkeeping lands in one workspace write.

export interface CheckResult {
  alerts: AlertRow[];
  checked: number;
  skipped_unchanged: number;
  meter: Meter;
  errors: string[];
}

interface RuleOutcome {
  status: "alert" | "unchanged" | "none";
  patch: { last_run_at: string; last_hash?: string; last_headline?: string | null };
  alert?: AlertRow;
}

export async function runChecks(account: AccountRow, product: ProductRow, opts: { force?: boolean; maxRules?: number } = {}): Promise<CheckResult> {
  const meter = newMeter();
  const rules = await listRules(product.id, account.id);
  const now = Date.now();
  const due = rules.filter((r) => {
    if (opts.force) return true;
    if (!r.last_run_at) return true;
    return now - new Date(r.last_run_at).getTime() > r.cadence_hours * 3600 * 1000;
  });
  // Never-run rules first, then the oldest; bound the work per request.
  due.sort((a, b) => (a.last_run_at ? new Date(a.last_run_at).getTime() : 0) - (b.last_run_at ? new Date(b.last_run_at).getTime() : 0));
  const batch = due.slice(0, opts.maxRules ?? 4);
  const skills = await listSkills(account.id, product.id);

  const errors: string[] = [];
  const outcomes = await mapLimit(batch, 3, async (rule) => {
    try {
      return { rule, outcome: await checkRule(account, product, rule, skills, meter, Boolean(opts.force)) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${rule.title}: ${msg}`);
      console.error("[shop-rules] rule failed", rule.key, msg);
      return { rule, outcome: null };
    }
  });

  const stamp = new Date().toISOString();
  const alerts: AlertRow[] = [];
  const rulePatches: Array<{ id: string; patch: RuleOutcome["patch"] }> = [];
  let skipped = 0;
  for (const { rule, outcome } of outcomes) {
    if (!outcome) continue;
    rulePatches.push({ id: rule.id, patch: outcome.patch });
    if (outcome.status === "unchanged") skipped += 1;
    if (outcome.alert) alerts.push(outcome.alert);
  }

  const saved = await applyCheckBatch(account.id, { productId: product.id, lastCheckedAt: stamp, rulePatches, alerts });
  for (const a of saved) await notifyTelegram(account, product, a);
  await recordRun(account, product.id, "check", meter);
  return { alerts: saved, checked: batch.length, skipped_unchanged: skipped, meter, errors };
}

async function checkRule(account: AccountRow, product: ProductRow, rule: RuleRow, skills: SkillRow[], meter: Meter, force: boolean): Promise<RuleOutcome> {
  const ranAt = new Date().toISOString();
  const search = await tavilySearch(
    {
      query: rule.query,
      search_depth: "advanced",
      max_results: 5,
      chunks_per_source: 3,
      include_domains: rule.include_domains,
      include_domains_mode: rule.include_domains_mode,
      time_range: "year",
      topic: "general",
    },
    meter,
  );

  const results: TavilyResult[] = (search.results ?? []).filter((r) => r.url && r.content).sort((a, b) => b.score - a.score).slice(0, 4);
  if (results.length === 0) return { status: "none", patch: { last_run_at: ranAt } };

  // Fuller text for the verifier: extract the top pages with the rule as the query.
  const sources: SourceText[] = [];
  const sourceMeta: Array<{ url: string; title: string; domain: string; published_date?: string }> = [];
  try {
    const ex = await tavilyExtract(
      results.map((r) => r.url),
      { query: rule.query, chunks_per_source: 3, extract_depth: "basic" },
      meter,
    );
    for (const r of results) {
      const full = ex.results.find((e) => e.url === r.url)?.raw_content;
      sources.push({ url: r.url, text: `${r.content}\n${full ?? ""}` });
      sourceMeta.push({ url: r.url, title: r.title, domain: domainOf(r.url), published_date: r.published_date });
    }
  } catch {
    for (const r of results) {
      sources.push({ url: r.url, text: r.content });
      sourceMeta.push({ url: r.url, title: r.title, domain: domainOf(r.url), published_date: r.published_date });
    }
  }

  const hash = createHash("sha256")
    .update(sources.map((s) => `${s.url}|${s.text.slice(0, 400)}`).sort().join("\n"))
    .digest("hex")
    .slice(0, 24);
  if (!force && rule.last_hash === hash) return { status: "unchanged", patch: { last_run_at: ranAt } };
  if (await alertExistsForRuleHash(rule.id, hash, account.id)) return { status: "unchanged", patch: { last_run_at: ranAt, last_hash: hash } };

  const settings = account.settings ?? {};
  const unitCostPct = settings.unit_cost_pct ?? 45;
  const marginPct = settings.target_margin_pct ?? 35;
  const today = new Date().toISOString().slice(0, 10);

  const sourceBlock = sources
    .map((s, i) => {
      const m = sourceMeta[i];
      return `--- SOURCE ${i + 1}\nurl: ${s.url}\ntitle: ${m.title}\npublished: ${m.published_date ?? "unknown"}\ntext:\n${s.text.slice(0, 3200)}`;
    })
    .join("\n\n");

  const standing = skills.length ? `\n\nStanding instructions from the seller (follow them):\n${skills.map((s) => `- ${s.text}`).join("\n")}` : "";
  const previous = rule.last_headline ? `\n\nThe last alert for this rule said: "${rule.last_headline}". If the sources say the same thing, return no_change.` : "";

  const check = await chatJSON(
    "ultra",
    {
      name: "rule_check",
      purpose: `rule check ${rule.key}`,
      schema: RuleCheckSchema,
      maxTokens: 1600,
      temperature: 0.1,
      system: [
        "You are Shop Rules, a compliance and pricing analyst for one small online seller.",
        "Decide whether the sources describe a tariff, duty, product-safety, sales-tax, or marketplace-policy requirement or change that touches THIS product.",
        "Use only the source excerpts. Every claim must carry a quote copied verbatim from a source (a separate verifier rejects quotes that are not in the text) and the url of that source.",
        "Never invent rates, dates, HTS codes, or thresholds. If the sources show nothing that applies to this product, return relevance no_change, empty claims, severity low, action type none.",
        "relevance affects: a requirement or change clearly applies to this product. might_affect: it plausibly applies but a detail (material, value, origin, state) is unconfirmed.",
        `Today is ${today}. Treat anything older than 18 months as background unless it is still the governing rule.`,
        "Pricing math for reprice actions: the seller's landed cost is about " +
          `${unitCostPct}% of the listing price and the target margin is ${marginPct}%. If a duty rises by D percentage points on landed cost, the price that keeps margin is price * (1 + D/100 * ${unitCostPct}/100). Round to the nearest 0.50 and put it in suggested_price; otherwise null.`,
        "Action types: reprice (duty or cost change), compliance_step (labeling, testing, registration, warnings), register_tax (nexus threshold crossed or rule changed), review (unclear, needs a human), none.",
        "steps: 2 to 5 concrete steps the seller can do today. headline: one sentence a seller understands, no jargon.",
        "Return JSON only.",
      ].join(" "),
      user: `PRODUCT\n${JSON.stringify({ title: product.title, price: product.price, currency: product.currency, marketplace: product.marketplace, origin: countryName(product.profile.origin_country), profile: product.profile }, null, 0)}\n\nWATCH RULE\n${rule.family} | ${rule.title}\nquery: ${rule.query}${rule.state ? `\nstate: ${rule.state}` : ""}${rule.seed_note ? `\nseed note: ${rule.seed_note}` : ""}${standing}${previous}\n\nSOURCES\n${sourceBlock}`,
    },
    meter,
  );

  const verified = verifyClaims(check.claims, sources);
  const headline = plain(check.headline).slice(0, 240);
  // "Effective today" is the model filling a blank, not a date it read.
  if (check.impact.effective_date === today) check.impact.effective_date = null;
  check.action = {
    ...check.action,
    title: plain(check.action.title),
    rationale: plain(check.action.rationale),
    steps: check.action.steps.map(plain),
  };
  for (const c of verified.claims) c.claim = plain(c.claim);
  const patch: RuleOutcome["patch"] = {
    last_run_at: ranAt,
    last_hash: hash,
    last_headline: check.relevance === "no_change" ? rule.last_headline : headline,
  };

  if (check.relevance === "no_change" || verified.backed === 0) return { status: "none", patch };

  const alert: AlertRow = {
    id: newId(),
    account_id: account.id,
    product_id: product.id,
    rule_id: rule.id,
    status: "new",
    family: rule.family,
    severity: check.impact.severity,
    relevance: check.relevance,
    headline,
    claims: verified.claims,
    proposed: verified.proposed,
    backed: verified.backed,
    rejected: verified.rejected,
    impact: { ...check.impact, hash },
    action: check.action,
    sources: sourceMeta.map(({ url, title, domain }) => ({ url, title, domain })),
    dismiss_reason: null,
    created_at: ranAt,
  };
  return { status: "alert", patch, alert };
}

// 3. Competitor prices for the extension's Compare card.

export async function compareListings(account: AccountRow, input: { title: string; price?: number | null; marketplace?: string; url?: string }): Promise<CompetitorListings & { meter: Meter }> {
  const meter = newMeter();
  const title = input.title.slice(0, 160);
  const search = await tavilySearch(
    {
      query: `${title} price`,
      search_depth: "advanced",
      max_results: 8,
      chunks_per_source: 2,
      include_domains: ["amazon.com", "etsy.com", "walmart.com", "ebay.com", "target.com"],
      include_domains_mode: "prefer",
      topic: "general",
    },
    meter,
  );
  const rows = (search.results ?? []).slice(0, 6).map((r, i) => `[${i + 1}] ${r.title.slice(0, 90)}\nurl: ${r.url.slice(0, 160)}\ntext: ${r.content.slice(0, 400)}`).join("\n\n");
  const parsed = await chatJSON(
    "nano",
    {
      name: "competitor_listings",
      purpose: "compare prices",
      schema: CompetitorListingsSchema,
      maxTokens: 1800,
      system: [
        "You read web search results about a product and list competing listings with the price actually visible in the text.",
        "At most 5 listings. Keep each title under 70 characters and copy the url exactly as given. Only include a listing when the text shows a price for a comparable product; price null is allowed when the listing matches but the price is missing. marketplace is the site name (amazon, etsy, walmart, ebay, target, other).",
        `The seller's own price is ${input.price ?? "unknown"}. price_position compares the seller to the median competitor price (below_market if 10% lower, above_market if 10% higher, at_market otherwise, unknown if no prices).`,
        "note: one sentence on what the seller should take from this. Return JSON only.",
      ].join(" "),
      user: `PRODUCT: ${title}${input.marketplace ? ` (sold on ${input.marketplace})` : ""}\n\nRESULTS\n${rows || "(no results)"}`,
    },
    meter,
  );
  // Drop the seller's own listing when the search returns it.
  const own = input.url ? safeNormalize(input.url) : null;
  const ownAsin = own?.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? null;
  parsed.listings = parsed.listings.filter((l) => {
    const n = safeNormalize(l.url);
    if (own && n && n === own) return false;
    if (ownAsin && l.url.toUpperCase().includes(ownAsin)) return false;
    return true;
  });
  // The position is arithmetic, not a judgement: median competitor price against the seller's.
  const prices = parsed.listings.map((l) => l.price).filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  let position: CompetitorListings["price_position"] = "unknown";
  let note = parsed.note;
  if (prices.length && input.price != null && input.price > 0) {
    const median = prices.length % 2 ? prices[(prices.length - 1) / 2] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
    const ratio = input.price / median;
    position = ratio < 0.9 ? "below_market" : ratio > 1.1 ? "above_market" : "at_market";
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    const where = position === "above_market" ? `${pct}% above` : position === "below_market" ? `${pct}% below` : "within 10% of";
    note = `Your ${input.price.toFixed(2)} is ${where} the median of ${median.toFixed(2)} across ${prices.length} listing${prices.length === 1 ? "" : "s"} with a visible price.`;
  }
  await recordRun(account, null, "compare", meter);
  return { ...parsed, note, price_position: position, meter };
}

// 4. A dismissal with a reason becomes a standing instruction for future checks.

export async function skillFromDismissal(account: AccountRow, alert: AlertRow, product: ProductRow | null, reason: string): Promise<SkillRow> {
  const meter = newMeter();
  const skill = await chatJSON(
    "nano",
    {
      name: "skill",
      purpose: "skill from dismissal",
      schema: SkillSchema,
      maxTokens: 300,
      system: [
        "A seller dismissed an alert and gave a reason. Write one reusable instruction (under 30 words) that a future checker should follow so it does not raise the same alert again.",
        "scope: product when it only applies to this product, family when it applies to all rules of this family, account when it applies to everything.",
        "Return JSON only.",
      ].join(" "),
      user: `Alert family: ${alert.family}\nHeadline: ${alert.headline}\nProduct: ${product?.title ?? "unknown"}\nSeller's reason: ${reason}`,
    },
    meter,
  );
  await recordRun(account, product?.id ?? null, "skill", meter);
  return insertSkill({ account_id: account.id, product_id: skill.scope === "product" ? alert.product_id : null, scope: skill.scope, text: skill.skill });
}

// 5. Telegram delivery, optional.

export async function notifyTelegram(account: AccountRow, product: ProductRow, alert: AlertRow): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = account.telegram_chat_id;
  if (!token || !chat) return;
  const base = process.env.APP_BASE_URL || "";
  const text = [
    `Shop Rules: ${alert.severity.toUpperCase()} ${alert.family} alert`,
    product.title,
    "",
    alert.headline,
    `Evidence: ${alert.backed} of ${alert.proposed} claims backed by the source text.`,
    `Action: ${alert.action.title}`,
    base ? `${base}/alerts/${alert.id}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
  } catch (err) {
    console.error("[shop-rules] telegram failed", err);
  }
}

export { costUsd, PRICES_PER_M };
export type { ProductProfile };
