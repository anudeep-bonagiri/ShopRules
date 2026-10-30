import { createHash } from "node:crypto";
import { ApiError } from "./account";
import {
  alertExistsForRuleHash,
  applyCheckBatch,
  saveCheckRun,
  type CheckRunRecord,
  type CheckScope,
  insertProductBundle,
  insertRun,
  insertSkill,
  listAlerts,
  reseedRules,
  listPrices,
  listRules,
  listSkills,
  newId,
  findProductByUrl,
  takeConflicts,
  type AccountRow,
  type AlertRow,
  type ProductRow,
  type RuleRow,
  type SkillRow,
} from "./db";
import { chatJSON, costUsd, PRICES_PER_M } from "./nemotron";
import { buildRules, countryName, marketplaceFromUrl, type RuleSpec } from "./rules-catalog";
import { pricingInputs, reprice } from "./pricing";
import { auditRuleCheck, historyContext } from "./sanity";
import { effectiveProfile, effectivePrice, pricingProduct } from "./product";
import { addExtract, addSearch, matchPassages, newTrail, setHash, setModel } from "./source-trail";
import { fetchHtsRate } from "./hts-rate";
import { comparePosition } from "./compare";
import { skillRowFromDismissal } from "./skills";
import { parseShopifyJson, shopifyJsonUrlFor, type ShopifyJsonProduct } from "./shopify-json";
import { guardNexusParse } from "./nexus";
import { catalogMenu, finalizeHts } from "./hts-catalog";
import {
  ClassifierOutputSchema,
  CompetitorListingsSchema,
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
    const trimmed = raw.trim();
    u = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new ApiError(400, "That does not look like a listing URL.");
  }
  const host = u.hostname.toLowerCase();
  if (!host.includes(".")) throw new ApiError(400, "That does not look like a listing URL.");
  if (u.pathname === "/" || u.pathname === "") {
    throw new ApiError(
      422,
      `${host} is a store homepage, not a product listing. Paste the product page itself: etsy.com/listing/..., amazon.com/dp/..., or yourstore.com/products/...`,
    );
  }
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
      conflicts: takeConflicts(),
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

// Listing readers. Marketplaces block fetchers; these keep the product honest
// when the page that came back is a bot wall or nothing at all.

const HOSTNAME_RE = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const BLOCKED_RE =
  /verify you are (a )?human|are you a robot|robot check|captcha|access denied|just a moment|attention required|press (and|&) hold|enable (javascript|cookies)|something went wrong on our end|api-services-support@amazon\.com|request blocked|unusual traffic|checking your browser|pardon our interruption/i;

function looksBlocked(text: string, title: string | null): boolean {
  if (text.length > 8000) return false;
  if (title && HOSTNAME_RE.test(title.trim())) return true;
  return BLOCKED_RE.test(text);
}

// A product name, or null when the string is a hostname, a store name, or a wall title.
export function cleanTitle(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, " ").trim();
  s = s
    .replace(/^amazon\.(com|ca|co\.uk|de)\s*:\s*/i, "")
    .replace(/\s*[-|:]\s*(etsy( [a-z]+)?|amazon\.com|shopify)$/i, "")
    .trim();
  // Amazon titles carry a keyword tail after a pipe; the listing name is the head.
  const head = s.split(" | ")[0].trim();
  if (head.length >= 20) s = head;
  if (s.length < 3) return null;
  if (HOSTNAME_RE.test(s)) return null;
  if (s.length < 32 && /^(etsy|amazon(\.com)?|shopify|just a moment|access denied|robot check|attention required|untitled)\b/i.test(s)) return null;
  return s;
}

// The listing slug in the URL as words: /listing/123/wooden-stacking-toy,
// /Wooden-Stacking-Toy/dp/B0..., /products/wooden-stacking-toy.
export function titleFromUrl(url: string): string | null {
  try {
    const path = decodeURIComponent(new URL(url.trim()).pathname);
    const m = path.match(/\/listing\/\d+\/([^/]+)/) ?? path.match(/^\/([^/]+)\/dp\//) ?? path.match(/\/products\/([^/]+)/);
    const slug = m?.[1]?.replace(/[-_+]+/g, " ").trim();
    if (!slug || slug.length < 3 || /^[a-z0-9]{10}$/i.test(slug)) return null;
    return slug.replace(/\b[a-z]/g, (c) => c.toUpperCase()).slice(0, 200);
  } catch {
    return null;
  }
}

// The same listing across locales and tracking variants: Etsy listing id,
// Amazon ASIN, Shopify handle, else host and path.
function listingKey(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname;
    const etsy = path.match(/\/listing\/(\d+)/);
    if (etsy) return `etsy:${etsy[1]}`;
    const asin = path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asin) return `amazon:${asin[1].toUpperCase()}`;
    const handle = path.match(/\/products\/([^/?#]+)/);
    if (handle) return `${host}:product:${handle[1].toLowerCase()}`;
    return `${host}:${path.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return null;
  }
}

async function indexedListing(url: string, rawUrl: string, meter: Meter): Promise<{ title: string; content: string } | null> {
  const key = listingKey(url);
  if (!key) return null;
  try {
    const res = await tavilySearch(
      {
        query: `${titleFromUrl(rawUrl) ?? ""} ${url}`.trim(),
        max_results: 5,
        search_depth: "advanced",
        chunks_per_source: 3,
        include_domains: [domainOf(url)],
        include_domains_mode: "strict",
        include_raw_content: "markdown",
      },
      meter,
    );
    const same = (res.results ?? []).filter((r) => listingKey(r.url) === key);
    if (!same.length) return null;
    const title = same.map((r) => r.title).find((t) => cleanTitle(t)) ?? same[0].title;
    const raw = same.map((r) => (r.raw_content ?? "").trim()).find((t) => t.length > 200 && !looksBlocked(t, null));
    const content = raw ? stripNav(raw) : Array.from(new Set(same.map((r) => r.content.trim()).filter(Boolean))).join("\n\n");
    return content.length >= 40 ? { title, content } : null;
  } catch (err) {
    console.error("[shop-rules] indexed listing lookup failed", err);
    return null;
  }
}

// Markdown from a store page opens with hundreds of nav links. Drop the lines
// that are only links or images so the classifier reads the listing.
function stripNav(markdown: string): string {
  const kept: string[] = [];
  for (const line of markdown.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const bare = t.replace(/!?\[[^\]]*\]\([^)]*\)/g, "").replace(/[*#>|\-\s_]+/g, "");
    if (bare.length < 3) continue;
    kept.push(t);
  }
  return kept.join("\n");
}

// 1. Ingest a listing: Tavily Extract reads the page, Nemotron Nano classifies it,
//    the catalog seeds the watch rules.

export interface IngestOptions {
  /** Client-chosen id so the form can poll GET /api/runs/[id] for the three-step progress. */
  runId?: string;
}

function ingestProgress(account: AccountRow, runId: string | undefined) {
  const valid = runId && /^[A-Za-z0-9_-]{8,64}$/.test(runId) ? runId : null;
  const run: CheckRunRecord | null = valid
    ? {
        id: valid,
        account_id: account.id,
        product_id: "",
        kind: "ingest",
        scope: "all",
        status: "running",
        total: 3,
        done: 0,
        current: [],
        items: [],
        steps: [
          { key: "read", label: "Reading listing", status: "active" },
          { key: "classify", label: "Classifying", status: "queued" },
          { key: "seed", label: "Seeding rules", status: "queued" },
        ],
        conflicts: 0,
        started_at: new Date().toISOString(),
        finished_at: null,
      }
    : null;
  const save = async () => {
    if (!run) return;
    try {
      await saveCheckRun(run);
    } catch (err) {
      console.error("[shop-rules] ingest progress write failed", err instanceof Error ? err.message : err);
    }
  };
  return {
    run,
    start: () => save(),
    step: async (key: "read" | "classify" | "seed", detail?: string) => {
      if (!run?.steps) return;
      for (const s of run.steps) {
        if (s.status === "active") s.status = "done";
        if (s.key === key) {
          s.status = "active";
          if (detail) s.detail = detail;
        }
      }
      run.done = run.steps.filter((s) => s.status === "done").length;
      await save();
    },
    finish: async (productId: string) => {
      if (!run) return;
      if (run.steps) for (const s of run.steps) if (s.status !== "error") s.status = "done";
      run.done = run.total;
      run.product_id = productId;
      run.status = "done";
      run.finished_at = new Date().toISOString();
      await save();
    },
    fail: async (message: string) => {
      if (!run) return;
      if (run.steps) for (const s of run.steps) if (s.status === "active") s.status = "error";
      run.status = "failed";
      run.error = message.slice(0, 300);
      run.finished_at = new Date().toISOString();
      await save();
    },
  };
}

export async function ingestProduct(account: AccountRow, rawUrl: string, page?: PageFields, opts: IngestOptions = {}): Promise<{ product: ProductRow; rules: RuleRow[]; meter: Meter; existing: boolean }> {
  const progress = ingestProgress(account, opts.runId);
  try {
    const result = await ingestProductInner(account, rawUrl, page, progress);
    await progress.finish(result.product.id);
    return result;
  } catch (err) {
    await progress.fail(err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function ingestProductInner(
  account: AccountRow,
  rawUrl: string,
  page: PageFields | undefined,
  progress: ReturnType<typeof ingestProgress>,
): Promise<{ product: ProductRow; rules: RuleRow[]; meter: Meter; existing: boolean }> {
  const url = normalizeListingUrl(rawUrl);
  const existing = await findProductByUrl(account.id, url);
  if (existing) return { product: existing, rules: await listRules(existing.id, account.id), meter: newMeter(), existing: true };
  await progress.start();

  const meter = newMeter();
  // The extension can see Shopify stores on custom domains that the URL alone does not reveal.
  const hinted = page?.marketplace && ["etsy", "shopify", "amazon"].includes(page.marketplace) ? (page.marketplace as "etsy" | "shopify" | "amazon") : null;
  let marketplace = hinted ?? marketplaceFromUrl(url);
  // A /products/<handle> page on an unknown host: ask the store's own .json the way
  // the extension does. An answer means Shopify on a custom domain, with exact fields.
  const shopJson = marketplace === "other" && shopifyJsonUrlFor(url) ? await readShopifyJson(url) : null;
  if (shopJson) marketplace = "shopify";

  let extracted = "";
  let extractTitle: string | null = null;
  let extractError: string | null = null;
  try {
    const ex = await tavilyExtract([url], { extract_depth: "advanced", format: "markdown" }, meter);
    extracted = ex.results[0]?.raw_content ?? "";
    extractTitle = ex.results[0]?.title ?? null;
    if (!extracted && ex.failed_results?.[0]) extractError = ex.failed_results[0].error;
  } catch (err) {
    extractError = err instanceof Error ? err.message : String(err);
  }
  // Marketplaces answer readers with a bot wall whose title is the bare hostname.
  // That text is not the listing, so it must not become the product.
  if (extracted && looksBlocked(extracted, extractTitle)) {
    extractError = "the marketplace served a bot check instead of the listing";
    extracted = "";
    extractTitle = null;
  }
  // When the live fetch fails, Tavily's index usually holds the listing: Search
  // with the URL as the query, restricted to the store, keeping only the result
  // that is the same listing (same listing id, ASIN, or product handle).
  let indexed: { title: string; content: string } | null = null;
  if (!extracted) {
    indexed = await indexedListing(url, rawUrl, meter);
    if (indexed) extractError = null;
  }

  const pageText = [
    page?.title ? `Title: ${page.title}` : shopJson?.title ? `Title: ${shopJson.title}` : "",
    !page?.price && shopJson?.price != null ? `Price: ${shopJson.price}` : "",
    !page?.description && shopJson?.description ? `Description: ${shopJson.description}` : "",
    shopJson?.product_type ? `Product type: ${shopJson.product_type}` : "",
    shopJson?.vendor ? `Vendor: ${shopJson.vendor}` : "",
    page?.price != null ? `Price: ${page.price} ${page.currency ?? ""}` : "",
    page?.materials?.length ? `Materials: ${page.materials.join(", ")}` : "",
    page?.description ? `Description: ${page.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const sourceText = extracted ? stripNav(extracted) : indexed ? `Title: ${indexed.title}\n${indexed.content}` : "";
  const combined = `${pageText}\n\n${sourceText}`.trim();
  if (combined.length < 40) {
    throw new ApiError(422, `Could not read that listing${extractError ? ` (${extractError})` : ""}. The store may block readers; open the page and add it from the extension, which sends the page fields along.`);
  }
  if (!page && !/\$\s?\d|price|add to cart|buy now|\b(usd|eur|gbp|cad)\b/i.test(combined)) {
    throw new ApiError(422, "That page does not look like a product listing (no price or buy button found). Paste the URL of one product.");
  }
  await progress.step("classify", `${Math.round(combined.length / 1000)}k characters read`);

  const classified = await chatJSON(
    "nano",
    {
      name: "product_profile",
      purpose: "classify listing",
      schema: ClassifierOutputSchema,
      system: [
        "You classify an e-commerce listing for a compliance and pricing watch service.",
        "Read the listing text and fill every field. Use null when the listing does not say.",
        "origin_country is the ISO 3166-1 alpha-2 code of where the product is made or ships from ONLY if the listing states it; otherwise null.",
        "hts_heading: the four-digit US Harmonized Tariff Schedule heading for this product, chosen ONLY from the HEADINGS menu below (answer with the four digits exactly as listed). hts_alternatives: up to two other menu headings that could apply. hts_confidence: 0 to 1.",
        "hts_detail: your best 6 or 8 digit refinement under that heading (like 9405.20.60), or null. It is a suggestion the seller verifies with a broker.",
        "intended_for_children is true for toys, kids' clothing, nursery items, or anything marketed to under-12s.",
        "keywords: up to 8 short search terms a customs broker or safety regulator would use for this product type.",
        "summary: two plain sentences describing the product for a regulator.",
        "Return JSON only.",
        "HEADINGS\n" + catalogMenu(),
      ].join(" "),
      user: `Marketplace: ${marketplace}\nURL: ${url}\n\nListing text:\n${combined.slice(0, 12000)}`,
      maxTokens: 1200,
    },
    meter,
  );
  const { hts_heading, hts_alternatives, hts_confidence, hts_detail, ...facts } = classified;
  // The catalog is the guardrail: off-list or unsupported headings fall back to keyword evidence.
  const hts = finalizeHts({ heading: hts_heading, alternatives: hts_alternatives, confidence: hts_confidence }, page?.title ?? facts.title, combined);
  const profile: ProductProfile = { ...facts, hts_candidates: hts.candidates, hts_detail: hts_detail ? plain(hts_detail).slice(0, 40) : null, hts_guarded: hts.guarded };

  // On Etsy and Amazon the page title is the listing title; on a Shopify store it
  // carries the shop name, so the classifier's name wins there.
  const siteTitle = marketplace === "amazon" || marketplace === "etsy" ? cleanTitle(extractTitle) : null;
  const price = page?.price ?? shopJson?.price ?? profile.price ?? null;
  const currency = profile.currency ?? page?.currency ?? (price != null ? "USD" : null);
  const imageUrl = page?.image ?? shopJson?.image ?? firstImage(extracted);

  await progress.step("seed", `${hts.candidates[0]?.code ? `HS ${hts.candidates[0].code}` : "classified"}`);
  // General duty rate for the heading, read from hts.usitc.gov with Tavily Extract. No model.
  let dutyRate: ProductRow["duty_rate"] = null;
  if (hts.candidates[0]?.code) {
    try {
      dutyRate = await fetchHtsRate(hts.candidates[0].code, meter, { detail: profile.hts_detail ?? null });
    } catch (err) {
      console.error("[shop-rules] hts rate read failed", err instanceof Error ? err.message : err);
    }
  }
  const states = account.settings?.ship_to_states?.length ? account.settings.ship_to_states : ["TX", "CA", "NY", "FL"];
  const specs: RuleSpec[] = buildRules(profile, marketplace, states);
  const bundle = await insertProductBundle(
    {
      account_id: account.id,
      url,
      marketplace,
      title: (cleanTitle(page?.title) ?? cleanTitle(shopJson?.title) ?? siteTitle ?? cleanTitle(profile.title) ?? cleanTitle(indexed?.title) ?? cleanTitle(extractTitle) ?? titleFromUrl(rawUrl) ?? "Untitled listing").slice(0, 200),
      price,
      currency,
      image_url: imageUrl,
      profile,
      duty_rate: dutyRate,
      extracted_text: combined.slice(0, 20000),
    },
    price != null ? { price, currency, source: page ? "extension" : "listing" } : null,
    specs,
  );
  await recordRun(account, bundle.product.id, "ingest", meter);
  return { product: bundle.product, rules: bundle.rules, meter, existing: bundle.existing };
}

// Rebuilds a product's rule set from its current merged profile and the
// workspace ship-to states. Rules whose key did not change keep their schedule
// and last finding. Used when the seller edits origin, HTS, materials, or the
// for-children flag, and when the ship-to states change.
export async function reseedProductRules(account: AccountRow, product: ProductRow): Promise<{ rules: RuleRow[]; added: number; removed: number; kept: number }> {
  const states = account.settings?.ship_to_states?.length ? account.settings.ship_to_states : ["TX", "CA", "NY", "FL"];
  const specs = buildRules(effectiveProfile(product), product.marketplace, states);
  return reseedRules(account.id, product.id, specs);
}

// Model prose for the UI: no em or en dashes, single spaces.
function plain(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// First image in the page markdown that is not the store's logo, icon, badge, or an SVG.
function firstImage(markdown: string): string | null {
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const alt = m[1].toLowerCase();
    const src = m[2].toLowerCase();
    if (/logo|icon|badge|payment|favicon|sprite|avatar|flag/.test(`${alt} ${src}`)) continue;
    if (/\.svg(\?|$)/.test(src)) continue;
    return m[2];
  }
  return null;
}

async function readShopifyJson(url: string): Promise<ShopifyJsonProduct | null> {
  const jsonUrl = shopifyJsonUrlFor(url);
  if (!jsonUrl) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch(jsonUrl, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 ShopRules/1.0" }, signal: ctl.signal, redirect: "follow" });
    if (!res.ok || !/json/i.test(res.headers.get("content-type") ?? "")) return null;
    return parseShopifyJson(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  run_id: string;
}

interface RuleOutcome {
  status: "alert" | "unchanged" | "none";
  patch: { last_run_at: string; last_hash?: string; last_headline?: string | null };
  alert?: AlertRow;
}

export const CHECK_SCOPES: CheckScope[] = ["due", "all", "tariff", "safety", "tax", "policy"];
export const MAX_RULES_PER_CHECK = 12;

export function isCheckScope(v: unknown): v is CheckScope {
  return typeof v === "string" && (CHECK_SCOPES as string[]).includes(v);
}

export function ruleIsDue(r: Pick<RuleRow, "last_run_at" | "cadence_hours">, now = Date.now()): boolean {
  if (!r.last_run_at) return true;
  return now - new Date(r.last_run_at).getTime() > r.cadence_hours * 3600 * 1000;
}

export interface RunChecksOptions {
  /** due: every rule whose cadence elapsed (default). all: every rule. A family: every rule of that family. */
  scope?: CheckScope;
  /** Skip the source-hash dedupe and call the model even when nothing changed. Costs money; off by default. */
  force?: boolean;
  maxRules?: number;
  /** Client-chosen id so the caller can poll GET /api/runs/[id] while this request is still running. */
  runId?: string;
}

export async function runChecks(account: AccountRow, product: ProductRow, opts: RunChecksOptions = {}): Promise<CheckResult> {
  const meter = newMeter();
  const scope: CheckScope = opts.scope ?? "due";
  const rules = await listRules(product.id, account.id);
  const now = Date.now();
  const selected = rules.filter((r) => {
    if (r.paused) return false;
    if (scope === "all") return true;
    if (scope === "due") return ruleIsDue(r, now);
    return r.family === scope;
  });
  // Never-run rules first, then the oldest; bound the work per request.
  selected.sort((a, b) => (a.last_run_at ? new Date(a.last_run_at).getTime() : 0) - (b.last_run_at ? new Date(b.last_run_at).getTime() : 0));
  const batch = selected.slice(0, Math.min(opts.maxRules ?? MAX_RULES_PER_CHECK, MAX_RULES_PER_CHECK));
  const skills = await listSkills(account.id, product.id);

  // Live progress record. Best effort: a storage hiccup must not fail the check.
  const run: CheckRunRecord = {
    id: opts.runId && /^[A-Za-z0-9_-]{8,64}$/.test(opts.runId) ? opts.runId : newId(),
    account_id: account.id,
    product_id: product.id,
    kind: "check",
    scope,
    status: "running",
    total: batch.length,
    done: 0,
    current: [],
    items: batch.map((r) => ({ rule_id: r.id, title: r.title, family: r.family, domain: r.include_domains[0] ?? "official source", status: "queued" as const })),
    conflicts: 0,
    started_at: new Date().toISOString(),
    finished_at: null,
  };
  const progress = async () => {
    try {
      await saveCheckRun(run);
    } catch (err) {
      console.error("[shop-rules] progress write failed", err instanceof Error ? err.message : err);
    }
  };
  const item = (rule: RuleRow) => run.items.find((i) => i.rule_id === rule.id)!;
  await progress();

  const errors: string[] = [];
  const outcomes = await mapLimit(batch, 3, async (rule) => {
    item(rule).status = "checking";
    run.current = run.items.filter((i) => i.status === "checking").map((i) => i.domain);
    void progress();
    try {
      const outcome = await checkRule(account, product, rule, skills, meter, Boolean(opts.force));
      item(rule).status = outcome.status === "alert" ? "alert" : outcome.status === "unchanged" ? "unchanged" : "clear";
      if (outcome.alert) item(rule).alert_id = outcome.alert.id;
      return { rule, outcome };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${rule.title}: ${msg}`);
      console.error("[shop-rules] rule failed", rule.key, msg);
      item(rule).status = "error";
      item(rule).error = msg.slice(0, 200);
      return { rule, outcome: null };
    } finally {
      run.done += 1;
      run.current = run.items.filter((i) => i.status === "checking").map((i) => i.domain);
      await progress();
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
  // Rules run three at a time, so two rules on the same product can surface the
  // same notice before either alert is written. Keep the first of any pair with
  // the same headline, or the same family, rate, and date.
  const seenKeys = new Set<string>();
  const kept: AlertRow[] = [];
  for (const a of alerts) {
    const headlineKey = `h:${a.headline.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()}`;
    const factKey = a.impact.tariff_rate_change_pct != null || a.impact.effective_date ? `f:${a.family}:${a.impact.tariff_rate_change_pct}:${a.impact.effective_date}:${a.impact.estimated_cost_change_pct}` : null;
    if (seenKeys.has(headlineKey) || (factKey && seenKeys.has(factKey))) {
      const patch = rulePatches.find((p) => p.id === a.rule_id);
      if (patch) patch.patch.last_headline = `${a.headline} (same finding as another rule on this product)`;
      continue;
    }
    seenKeys.add(headlineKey);
    if (factKey) seenKeys.add(factKey);
    kept.push(a);
  }
  alerts.length = 0;
  alerts.push(...kept);

  let saved: AlertRow[] = [];
  try {
    saved = await applyCheckBatch(account.id, { productId: product.id, lastCheckedAt: stamp, rulePatches, alerts });
  } catch (err) {
    run.status = "failed";
    run.finished_at = new Date().toISOString();
    await progress();
    throw err;
  }
  run.status = "done";
  run.finished_at = new Date().toISOString();
  await progress();
  for (const a of saved) await notifyTelegram(account, product, a);
  await recordRun(account, product.id, "check", meter);
  return { alerts: saved, checked: batch.length, skipped_unchanged: skipped, meter, errors, run_id: run.id };
}

export interface RuleCheckPromptInput {
  product: Pick<ProductRow, "title" | "price" | "currency" | "marketplace" | "profile">;
  rule: Pick<RuleRow, "family" | "title" | "query" | "state" | "seed_note">;
  skills: string[];
  /** Output of historyContext(): prior alerts for this rule and the price trend. */
  history: string;
  sources: Array<{ url: string; title: string; published_date?: string; text: string }>;
  today: string;
}

// One prompt builder for the live check and for scripts/eval.mts, so the
// accuracy numbers in docs/EVAL.md measure the prompt that actually ships.
export function buildRuleCheckPrompt(i: RuleCheckPromptInput): { system: string; user: string } {
  const sourceBlock = i.sources
    .map((s, n) => `--- SOURCE ${n + 1}\nurl: ${s.url}\ntitle: ${s.title}\npublished: ${s.published_date ?? "unknown"}\ntext:\n${s.text.slice(0, 3200)}`)
    .join("\n\n");
  const standing = i.skills.length ? `\n\nStanding instructions from the seller (follow them):\n${i.skills.map((s) => `- ${s}`).join("\n")}` : "";
  const history = i.history ? `\n\nHISTORY\n${i.history}` : "";
  const system = [
    "You are Shop Rules, a compliance and pricing analyst for one small online seller.",
    "Decide whether the sources describe a tariff, duty, product-safety, sales-tax, or marketplace-policy requirement or change that touches THIS product.",
    "Use only the source excerpts. Every claim must carry a quote copied verbatim from a source (a separate verifier rejects quotes that are not in the text) and the url of that source.",
    "Stay on this product and this rule: ignore passages about other product types, other tariff headings, other countries of origin, or other states, even on the same page. Do not use anything you remember from training; if the sources do not say it, it is not a fact here.",
    "Never invent rates, dates, HTS codes, or thresholds. If the sources show nothing that applies to this product, return relevance no_change, empty claims, severity low, action type none.",
    "relevance affects: a requirement or change clearly applies to this product. might_affect: it plausibly applies but a detail (material, value, origin, state) is unconfirmed.",
    `Today is ${i.today}. Treat anything older than 18 months as background unless it is still the governing rule. effective_date only when a source states the date; never today's date as a placeholder.`,
    "Report facts only, never a price: tariff_rate_change_pct is the change in the duty rate in percentage points when a source states the increase or both the old and new rate (a rise from 25% to 37.5% is 12.5); estimated_cost_change_pct only when a source gives a cost or fee figure as a percent of product value; otherwise null. The server computes any reprice from these numbers.",
    "Action types: reprice (duty or cost change, tariff rules only), compliance_step (labeling, testing, registration, warnings), register_tax (nexus threshold crossed or rule changed), review (unclear, needs a human), none.",
    "If HISTORY lists an alert that already says what the sources say, return no_change; report only what is new or different from it.",
    "severity high only for a confirmed change of 5 or more duty points or a mandatory safety or tax step with a date; medium for smaller or unconfirmed changes; low otherwise.",
    "impact.nexus: for sales-tax rules only, the economic nexus threshold exactly as a quoted source states it: dollars (number, no commas), transactions (number) and operator (or, and) when both tests exist; null for any value the quotes do not state, and null entirely for other rule families.",
    "steps: 2 to 5 concrete steps the seller can do today. headline: one sentence a seller understands, no jargon, no dashes.",
    "Return JSON only.",
  ].join(" ");
  const user = `PRODUCT\n${JSON.stringify({ title: i.product.title, price: i.product.price, currency: i.product.currency, marketplace: i.product.marketplace, origin: countryName(i.product.profile.origin_country), profile: i.product.profile }, null, 0)}\n\nWATCH RULE\n${i.rule.family} | ${i.rule.title}\nquery: ${i.rule.query}${i.rule.state ? `\nstate: ${i.rule.state}` : ""}${i.rule.seed_note ? `\nseed note: ${i.rule.seed_note}` : ""}${standing}${history}\n\nSOURCES\n${sourceBlock}`;
  return { system, user };
}

async function checkRule(account: AccountRow, product: ProductRow, rule: RuleRow, skills: SkillRow[], meter: Meter, force: boolean): Promise<RuleOutcome> {
  const ranAt = new Date().toISOString();
  // The trail records every Tavily call and matched passage behind the verdict.
  const trail = newTrail(rule, "year");
  const search = await tavilySearch(
    {
      query: rule.query,
      search_depth: "advanced",
      max_results: 5,
      chunks_per_source: 3,
      include_domains: rule.include_domains,
      include_domains_mode: rule.family === "tax" ? "strict" : rule.include_domains_mode,
      time_range: "year",
      topic: "general",
    },
    meter,
  );

  const results: TavilyResult[] = (search.results ?? []).filter((r) => r.url && r.content).sort((a, b) => b.score - a.score).slice(0, 4);
  addSearch(trail, search.results ?? [], results.map((r) => r.url));
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
    addExtract(trail, results.map((r) => r.url), ex);
    for (const r of results) {
      const full = ex.results.find((e) => e.url === r.url)?.raw_content;
      sources.push({ url: r.url, text: `${r.content}\n${full ?? ""}` });
      sourceMeta.push({ url: r.url, title: r.title, domain: domainOf(r.url), published_date: r.published_date });
    }
  } catch {
    addExtract(trail, results.map((r) => r.url), null);
    for (const r of results) {
      sources.push({ url: r.url, text: r.content });
      sourceMeta.push({ url: r.url, title: r.title, domain: domainOf(r.url), published_date: r.published_date });
    }
  }

  const hash = createHash("sha256")
    .update(sources.map((s) => `${s.url}|${s.text.slice(0, 400)}`).sort().join("\n"))
    .digest("hex")
    .slice(0, 24);
  setHash(trail, hash);
  if (!force && rule.last_hash === hash) return { status: "unchanged", patch: { last_run_at: ranAt } };
  if (await alertExistsForRuleHash(rule.id, hash, account.id)) return { status: "unchanged", patch: { last_run_at: ranAt, last_hash: hash } };

  const settings = account.settings ?? {};
  const today = new Date().toISOString().slice(0, 10);

  // What the seller was already told for this rule, and how the price moved:
  // the model sees it so it reports only what is new, and the guardrails use it
  // to drop repeats.
  const [productAlerts, priceRows] = await Promise.all([
    listAlerts(account.id, "all", product.id),
    listPrices(product.id, account.id).catch(() => []),
  ]);
  const previousAlerts = productAlerts.filter((a) => a.rule_id === rule.id);
  const history = historyContext(previousAlerts, priceRows.map((p) => ({ at: p.at, price: Number(p.price) })), today);

  const view = { ...product, profile: effectiveProfile(product), price: effectivePrice(product) };
  const prompt = buildRuleCheckPrompt({
    product: view,
    rule,
    skills: skills.map((s) => (s.rewrite && s.rewrite !== s.text ? `${s.text} (in short: ${s.rewrite})` : s.text)),
    history,
    sources: sources.map((s, i) => ({ url: s.url, title: sourceMeta[i].title, published_date: sourceMeta[i].published_date, text: s.text })),
    today,
  });
  const raw = await chatJSON(
    "ultra",
    { name: "rule_check", purpose: `rule check ${rule.key}`, schema: RuleCheckSchema, maxTokens: 1600, temperature: 0.1, system: prompt.system, user: prompt.user },
    meter,
  );

  setModel(trail, meter.llm.at(-1) ?? null);

  // "Effective today" is the model filling a blank, not a date it read.
  if (raw.impact.effective_date === today) raw.impact.effective_date = null;
  const verifiedRaw = verifyClaims(raw.claims, sources);

  // Deterministic guardrails: numbers must be in the quotes, actions must fit the
  // rule, the quotes must be about this product, and repeats are dropped.
  const audit = auditRuleCheck({ check: raw, verified: verifiedRaw.claims, rule, product: view, previous: productAlerts, sources, today });
  const check = audit.check;
  const backedCount = audit.verified.filter((c) => c.backed).length;
  // Sales-tax rules: the parsed threshold counts only when a backed quote states the numbers.
  const nexusGuard = rule.family === "tax" ? guardNexusParse(raw.impact.nexus, audit.verified.filter((c) => c.backed).map((c) => c.quote).join(" \n ")) : null;
  if (nexusGuard?.reason) console.info("[shop-rules] nexus parse", rule.key, nexusGuard.reason);
  const verified = { claims: audit.verified, proposed: audit.verified.length, backed: backedCount, rejected: audit.verified.length - backedCount };
  const headline = plain(check.headline).slice(0, 240);
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
    last_headline: audit.drop ? rule.last_headline : headline,
  };

  if (audit.drop) {
    if (audit.issues.length) console.info("[shop-rules] guardrails dropped a verdict", rule.key, audit.dropReason);
    return { status: "none", patch };
  }

  // The model reports facts; the price comes from pricing.ts, never from the prompt.
  const pricingIn = pricingInputs(pricingProduct(product), check.impact, settings);
  const pricing = pricingIn ? reprice(pricingIn) : null;

  const alert: AlertRow = {
    id: newId(),
    account_id: account.id,
    product_id: product.id,
    rule_id: rule.id,
    status: "new",
    family: rule.family,
    severity: check.impact.severity,
    relevance: check.relevance === "no_change" ? "might_affect" : check.relevance,
    headline,
    claims: verified.claims,
    proposed: verified.proposed,
    backed: verified.backed,
    rejected: verified.rejected,
    impact: { ...check.impact, nexus: nexusGuard?.parsed ?? null, nexus_verified: nexusGuard?.verified ?? false, hash },
    action: { ...check.action, suggested_price: pricing?.suggested_price ?? null },
    pricing,
    guardrails: audit.issues,
    trail: matchPassages(trail, verified.claims, sources),
    sources: sourceMeta.map(({ url, title, domain }) => ({ url, title, domain })),
    dismiss_reason: null,
    created_at: ranAt,
  };
  return { status: "alert", patch, alert };
}

// 3. Competitor prices for the extension's Compare card.

export async function compareListings(account: AccountRow, input: { title: string; price?: number | null; marketplace?: string; url?: string }): Promise<CompetitorListings & { sample: number; median: number | null; meter: Meter }> {
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
  const verdict = comparePosition(prices, input.price ?? null);
  await recordRun(account, null, "compare", meter);
  return { ...parsed, note: verdict.note ?? parsed.note, price_position: verdict.position, sample: prices.length, median: verdict.median, meter };
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
  return insertSkill(skillRowFromDismissal(account.id, alert.product_id, reason, skill));
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
