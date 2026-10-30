import postgres from "postgres";
import { del, get, list, put } from "./blob";
import { offlineMode } from "./offline";
import type { CompetitorListings, Marketplace, ProductProfile, RuleFamily, VerifiedClaim } from "./schemas";
import type { RuleSpec } from "./rules-catalog";
import type { PricingResult } from "./pricing";
import type { GuardrailIssue } from "./sanity";
import type { ProductOverrides } from "./product";
import type { SourceTrail } from "./source-trail";
import type { HtsRateResult } from "./hts-rate";
import type { NexusVerification } from "./nexus-crawl";
import { decideQuota, limitFor, pruneUsage, usageKey, type LimitKind, type QuotaDecision } from "./limits";

// Server-only data layer. Each workspace (account) is one JSON document: a
// Postgres row (DATABASE_URL, apps/web/supabase/store.sql) or, on the alternative
// backend, immutable version files under accounts/<id>/ in Vercel Blob (or the
// file-backed store in demo mode). Every write is compare-and-swap on the
// document version. The relational sketch in apps/web/supabase/migration.sql is
// for splitting the document later.

export interface AccountRow {
  id: string;
  token: string;
  telegram_chat_id: string | null;
  settings: {
    ship_to_states?: string[];
    target_margin_pct?: number;
    currency?: string;
    unit_cost_pct?: number;
    units_per_week?: number;
    /** 0..1 share of landed cost that is customs value. */
    dutiable_share?: number;
    rounding?: 0.5 | 0.99 | 0.01;
    /** Price move (percent) that raises a price_change alert. */
    price_change_pct?: number;
    /** Current-year dollars per state, typed by hand or set from the import. */
    state_sales?: Record<string, number>;
    /** From the orders CSV import: year -> state -> dollars and order count. Aggregates only. */
    state_sales_by_year?: Record<string, Record<string, { dollars: number; orders: number }>>;
    sales_import?: { source: "shopify" | "etsy"; imported_at: string; orders_seen: number; years: number[] } | null;
  };
  /** Daily counters for the paid endpoints, keyed YYYY-MM-DD:kind. See limits.ts. */
  usage?: Record<string, number>;
  created_at: string;
}

export interface ProductRow {
  id: string;
  account_id: string;
  url: string;
  marketplace: Marketplace;
  title: string;
  price: number | null;
  currency: string | null;
  image_url: string | null;
  profile: ProductProfile;
  /** Seller-set fields; see product.ts. The classifier never writes here. */
  overrides?: ProductOverrides | null;
  /** General duty rate read from hts.usitc.gov for the product's heading (hts-rate.ts). */
  duty_rate?: HtsRateResult | null;
  /** Last competitor search, kept 24 h because it is a paid call. */
  compare_cache?: { at: string; result: CompetitorListings & { price_position: string } } | null;
  extracted_text: string | null;
  created_at: string;
  last_checked_at: string | null;
  open_alerts?: number;
  /** Last 30 price points, oldest first, for list views (sparkline and change since first seen). */
  price_points?: Array<{ at: string; price: number }>;
}

export interface RuleRow extends RuleSpec {
  id: string;
  account_id: string;
  product_id: string;
  last_run_at: string | null;
  last_hash: string | null;
  last_headline: string | null;
  /** Paused rules are skipped by checks and cron until resumed. */
  paused?: boolean;
  created_at: string;
}

export interface AlertRow {
  id: string;
  account_id: string;
  product_id: string;
  rule_id: string;
  status: "new" | "dismissed" | "actioned";
  family: RuleFamily;
  /** rule (default): raised by a rule check. price: raised by price tracking (prices.ts). */
  kind?: "rule" | "price";
  /** Set on kind "price". */
  price_change?: { old_price: number; new_price: number; delta: number; pct: number } | null;
  severity: "high" | "medium" | "low";
  relevance: "affects" | "might_affect";
  headline: string;
  claims: VerifiedClaim[];
  proposed: number;
  backed: number;
  rejected: number;
  impact: {
    severity: string;
    effective_date: string | null;
    tariff_rate_change_pct: number | null;
    estimated_cost_change_pct: number | null;
    hash?: string;
    /** Sales-tax rules: the threshold the quote states, kept only when the guard found the numbers in a backed quote. */
    nexus?: { dollars: number | null; transactions: number | null; operator: "or" | "and" | null } | null;
    nexus_verified?: boolean;
  };
  action: { type: string; title: string; steps: string[]; suggested_price: number | null; rationale: string };
  /** Deterministic reprice math computed server-side from the alert facts (pricing.ts). Absent on alerts older than this field. */
  pricing?: PricingResult | null;
  /** What the deterministic guardrails changed on the model's verdict before this alert was raised (sanity.ts). */
  guardrails?: GuardrailIssue[];
  /** Every Tavily call behind this alert and the passages the verifier matched (source-trail.ts). */
  trail?: SourceTrail | null;
  sources: Array<{ url: string; title: string; domain: string }>;
  dismiss_reason: string | null;
  created_at: string;
  product_title?: string;
  rule_title?: string;
}

export interface RunRow {
  id: string;
  account_id: string;
  product_id: string | null;
  kind: string;
  tavily_calls: number;
  tavily_credits: number;
  llm: Array<{ tier: string; model: string; prompt_tokens: number; completion_tokens: number; ms: number; cost_usd: number; purpose: string }>;
  llm_cost_usd: number;
  all_ultra_cost_usd: number;
  duration_ms: number;
  /** Compare-and-swap retries seen while this run was writing. */
  conflicts?: number;
  created_at: string;
}

export interface SkillRow {
  id: string;
  account_id: string;
  product_id: string | null;
  scope: string;
  text: string;
  created_at: string;
}

export interface PriceRow {
  id: string;
  product_id: string;
  price: number;
  currency: string | null;
  source: string;
  at: string;
}

// Rule Forge: a check written as code by the agent, run and tested in a sandbox.
export interface ForgeStep {
  kind: "sources" | "write" | "tests" | "run" | "revise";
  title: string;
  detail: string;
  at: string;
  ms?: number;
  model?: "nano" | "super" | "ultra";
  ok?: boolean;
  code?: string;
  operation_id?: string;
  output?: Record<string, unknown>;
}

export interface ForgeRow {
  id: string;
  account_id: string;
  product_id: string;
  rule_id: string;
  rule_title: string;
  fact_name: string;
  status: "passed" | "failed" | "unrun";
  iterations: number;
  code: string;
  tests: string;
  sources: Array<{ url: string; title: string }>;
  last_output: Record<string, unknown> | null;
  steps: ForgeStep[];
  sandbox_image: string;
  sandbox_note: string | null;
  llm_cost_usd: number;
  tavily_calls: number;
  duration_ms: number;
  created_at: string;
  product_title?: string;
}

interface Workspace {
  version: number;
  account: AccountRow;
  products: ProductRow[];
  rules: RuleRow[];
  alerts: AlertRow[];
  runs: RunRow[];
  skills: SkillRow[];
  prices: PriceRow[];
  forges?: ForgeRow[];
  /** Nexus thresholds verified on the state revenue sites with Tavily Map, Crawl, and Extract. */
  nexus_verifications?: Record<string, NexusVerification>;
}

const ACCESS = { access: "private" as const };
const MAX_RUNS = 400;
const KEEP_VERSIONS = 3;

// Two document stores share one interface. Postgres (DATABASE_URL) is the
// default when set: one row per workspace, read in one query, written with a
// compare-and-swap version check. Vercel Blob (BLOB_READ_WRITE_TOKEN) keeps
// immutable versions named by version number so a write is create-only (the
// same compare-and-swap, D-14) and lists them to find the newest; in development
// without a token the identical code runs on the file-backed store in blob.ts
// (demo mode). Vercel bills a list as an advanced operation and suspended the
// Blob store on the Hobby plan, which is why Postgres is the default (D-17).

interface DocStore {
  load(id: string): Promise<Workspace | null>;
  /** Writes ws, whose version is already expectedVersion + 1; throws WriteConflict when the store moved on. */
  save(id: string, ws: Workspace, expectedVersion: number): Promise<void>;
  remove(id: string, token: string | null): Promise<void>;
  ids(): Promise<string[]>;
  tokenGet(token: string): Promise<string | null>;
  tokenSet(token: string, accountId: string): Promise<void>;
  tokenDel(token: string): Promise<void>;
}

const forcedLocal = () => process.env.SR_OFFLINE === "1" || process.env.SR_LOCAL_STORE === "1";

export function storeName(): "postgres" | "blob" | "local" | "none" {
  if (!forcedLocal() && process.env.DATABASE_URL) return "postgres";
  if (offlineMode().store === "local") return "local";
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  return "none";
}

export function dbConfigured(): boolean {
  return storeName() !== "none";
}

function requireDb(): void {
  if (!dbConfigured()) throw new Error("Storage is not configured. Set DATABASE_URL (Postgres) or BLOB_READ_WRITE_TOKEN (Vercel Blob) in the environment.");
}

function now(): string {
  return new Date().toISOString();
}

function uid(): string {
  return crypto.randomUUID();
}

export function newId(): string {
  return uid();
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return "sr_live_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Conflicts seen by this server instance since the last run record was written.
let conflictCounter = 0;
export function takeConflicts(): number {
  const n = conflictCounter;
  conflictCounter = 0;
  return n;
}

class WriteConflict extends Error {
  constructor(id: string, version: number) {
    super(`Workspace ${id} version ${version} was written by someone else`);
  }
}

// Postgres store

let sqlClient: ReturnType<typeof postgres> | null = null;

function sql(): ReturnType<typeof postgres> {
  if (!sqlClient) {
    sqlClient = postgres(process.env.DATABASE_URL as string, {
      max: 4,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: process.env.DATABASE_SSL === "off" ? undefined : "require",
    });
  }
  return sqlClient;
}

const pgStore: DocStore = {
  async load(id) {
    const rows = await sql()<Array<{ doc: Workspace | string }>>`select doc from workspaces where id = ${id}`;
    const doc = rows[0]?.doc;
    if (doc == null) return null;
    return typeof doc === "string" ? (JSON.parse(doc) as Workspace) : doc;
  },
  async save(id, ws, expectedVersion) {
    // Insert when the row is new; otherwise update only if nobody moved the version.
    const rows = await sql()<Array<{ id: string }>>`
      insert into workspaces (id, doc, version, updated_at)
      values (${id}, ${sql().json(ws as unknown as postgres.JSONValue)}, ${ws.version}, now())
      on conflict (id) do update
        set doc = excluded.doc, version = excluded.version, updated_at = now()
        where workspaces.version = ${expectedVersion}
      returning id`;
    if (!rows.length) throw new WriteConflict(id, ws.version);
  },
  async remove(id) {
    await sql()`delete from tokens where account_id = ${id}`;
    await sql()`delete from workspaces where id = ${id}`;
  },
  async ids() {
    const rows = await sql()<Array<{ id: string }>>`select id from workspaces order by updated_at desc`;
    return rows.map((r) => r.id);
  },
  async tokenGet(token) {
    const rows = await sql()<Array<{ account_id: string }>>`select account_id from tokens where token = ${token}`;
    return rows[0]?.account_id ?? null;
  },
  async tokenSet(token, accountId) {
    await sql()`insert into tokens (token, account_id) values (${token}, ${accountId}) on conflict (token) do update set account_id = excluded.account_id`;
  },
  async tokenDel(token) {
    await sql()`delete from tokens where token = ${token}`;
  },
};

// Vercel Blob store (or the file-backed store from blob.ts in demo mode)

const accountDir = (id: string) => `accounts/${id}/`;
const legacyPath = (id: string) => `accounts/${id}.json`;
const tokenPath = (token: string) => `tokens/${token}.json`;

// Version files are named by the document version so a write is create-only:
// two writers that both read version N and try to create v(N+1) cannot both
// succeed. The "v" prefix sorts after the legacy "<timestamp>-<rand>.json"
// names, so the newest version is still the lexicographically last blob.
function versionName(id: string, version: number): string {
  return `${accountDir(id)}v${String(version).padStart(12, "0")}.json`;
}

async function readBlob<T>(pathOrUrl: string): Promise<T | null> {
  try {
    const result = await get(pathOrUrl, { ...ACCESS, useCache: false });
    if (!result || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as T;
  } catch (err) {
    const status = (err as { status?: number }).status;
    const name = (err as { name?: string }).name ?? "";
    if (status === 404 || /NotFound/i.test(name)) return null;
    throw err;
  }
}

async function listVersions(id: string): Promise<Array<{ pathname: string; url: string }>> {
  const out: Array<{ pathname: string; url: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: accountDir(id), cursor, limit: 1000 });
    for (const b of page.blobs) out.push({ pathname: b.pathname, url: b.url });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  out.sort((a, b) => a.pathname.localeCompare(b.pathname));
  return out;
}

async function pruneVersions(id: string): Promise<void> {
  const versions = await listVersions(id);
  if (versions.length <= KEEP_VERSIONS + 3) return;
  const stale = versions.slice(0, versions.length - KEEP_VERSIONS);
  await del(stale.map((v) => v.url));
}

const blobStore: DocStore = {
  async load(id) {
    const versions = await listVersions(id);
    const newest = versions.at(-1);
    if (newest) return readBlob<Workspace>(newest.url);
    // Workspaces created before versioning lived at accounts/<id>.json.
    return readBlob<Workspace>(legacyPath(id));
  },
  async save(id, ws) {
    const name = versionName(id, ws.version);
    try {
      // No allowOverwrite: the store refuses the put when this version already exists.
      await put(name, JSON.stringify(ws), { ...ACCESS, addRandomSuffix: false, allowOverwrite: false, contentType: "application/json", cacheControlMaxAge: 0 });
    } catch (err) {
      const exists = (await listVersions(id)).some((v) => v.pathname === name);
      if (exists) throw new WriteConflict(id, ws.version);
      throw err;
    }
    void pruneVersions(id).catch(() => undefined);
  },
  async remove(id, token) {
    const urls = (await listVersions(id)).map((v) => v.url);
    if (token) urls.push(tokenPath(token));
    urls.push(legacyPath(id));
    await del(urls);
  },
  async ids() {
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "accounts/", mode: "folded", cursor, limit: 1000 });
      for (const f of page.folders ?? []) {
        const m = f.match(/^accounts\/([^/]+)\/$/);
        if (m) ids.add(m[1]);
      }
      for (const b of page.blobs) {
        const m = b.pathname.match(/^accounts\/([^/]+)\.json$/);
        if (m) ids.add(m[1]);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return Array.from(ids);
  },
  async tokenGet(token) {
    const doc = await readBlob<{ account_id: string }>(tokenPath(token));
    return doc?.account_id ?? null;
  },
  async tokenSet(token, accountId) {
    await put(tokenPath(token), JSON.stringify({ account_id: accountId }), { ...ACCESS, addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 0 });
  },
  async tokenDel(token) {
    await del(tokenPath(token)).catch(() => undefined);
  },
};

function store(): DocStore {
  requireDb();
  return storeName() === "postgres" ? pgStore : blobStore;
}

// Workspace documents

async function loadWorkspace(id: string): Promise<Workspace | null> {
  return store().load(id);
}

async function writeWorkspace(id: string, ws: Workspace, expectedVersion: number): Promise<void> {
  ws.version = expectedVersion + 1;
  try {
    await store().save(id, ws, expectedVersion);
  } catch (err) {
    ws.version = expectedVersion;
    throw err;
  }
}

// Read, apply, write-if-unchanged. On a conflict the function re-reads the
// newest version and applies `fn` again, up to 5 times with jitter, so a cron
// run, a user check, and a run record can never overwrite each other silently.
async function mutate<T>(accountId: string, fn: (ws: Workspace) => T | Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const ws = await loadWorkspace(accountId);
      if (!ws) throw new Error(`Workspace ${accountId} not found`);
      const seen = ws.version ?? 0;
      const result = await fn(ws);
      await writeWorkspace(accountId, ws, seen);
      return result;
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && /not found/i.test(err.message)) throw err;
      if (err instanceof WriteConflict) {
        conflictCounter += 1;
        console.warn("[shop-rules] write conflict, retrying", err.message);
      }
      await new Promise((r) => setTimeout(r, 120 * (attempt + 1) + Math.random() * 200));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Workspace write failed");
}

async function requireWorkspace(accountId: string): Promise<Workspace> {
  const ws = await loadWorkspace(accountId);
  if (!ws) throw new Error(`Workspace ${accountId} not found`);
  return ws;
}

// Accounts

export async function getOrCreateAccount(id: string): Promise<AccountRow> {
  const ws = await loadWorkspace(id);
  if (ws) return ws.account;
  const account: AccountRow = {
    id,
    token: newToken(),
    telegram_chat_id: null,
    settings: { ship_to_states: ["TX", "CA", "NY", "FL"], target_margin_pct: 35, currency: "USD", unit_cost_pct: 45, units_per_week: 20, state_sales: {} },
    created_at: now(),
  };
  const fresh: Workspace = { version: 0, account, products: [], rules: [], alerts: [], runs: [], skills: [], prices: [] };
  try {
    await writeWorkspace(id, fresh, fresh.version ?? 0);
  } catch (err) {
    // Several first-visit requests race to create the same workspace; the
    // compare-and-swap lets exactly one win and the others read its result.
    if (err instanceof WriteConflict) {
      const won = await loadWorkspace(id);
      if (won) return won.account;
    }
    throw err;
  }
  await store().tokenSet(account.token, id);
  return account;
}

export async function getAccountByToken(token: string): Promise<AccountRow | null> {
  if (!/^sr_live_[a-f0-9]{36}$/.test(token)) return null;
  const accountId = await store().tokenGet(token);
  if (!accountId) return null;
  const ws = await loadWorkspace(accountId);
  return ws?.account ?? null;
}

export async function updateAccount(id: string, patch: Partial<Pick<AccountRow, "settings" | "telegram_chat_id">>): Promise<AccountRow> {
  return mutate(id, (ws) => {
    if (patch.settings) ws.account.settings = { ...ws.account.settings, ...patch.settings };
    if (patch.telegram_chat_id !== undefined) ws.account.telegram_chat_id = patch.telegram_chat_id;
    return ws.account;
  });
}

export async function listAccountIds(): Promise<string[]> {
  return store().ids();
}

export async function deleteAccount(id: string): Promise<void> {
  const ws = await loadWorkspace(id).catch(() => null);
  await store().remove(id, ws?.account.token ?? null);
}

// Products

function withOpenCounts(ws: Workspace, products: ProductRow[]): ProductRow[] {
  const counts = new Map<string, number>();
  for (const a of ws.alerts) if (a.status === "new") counts.set(a.product_id, (counts.get(a.product_id) ?? 0) + 1);
  const points = new Map<string, Array<{ at: string; price: number }>>();
  for (const pr of ws.prices) {
    const list = points.get(pr.product_id) ?? [];
    list.push({ at: pr.at, price: Number(pr.price) });
    points.set(pr.product_id, list);
  }
  return products.map((p) => ({
    ...p,
    open_alerts: counts.get(p.id) ?? 0,
    price_points: (points.get(p.id) ?? []).sort((a, b) => a.at.localeCompare(b.at)).slice(-30),
  }));
}

export async function listProducts(accountId: string): Promise<ProductRow[]> {
  const ws = await requireWorkspace(accountId);
  const sorted = [...ws.products].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return withOpenCounts(ws, sorted);
}

export async function getProduct(accountId: string, id: string): Promise<ProductRow | null> {
  const ws = await requireWorkspace(accountId);
  const p = ws.products.find((x) => x.id === id);
  return p ? withOpenCounts(ws, [p])[0] : null;
}

export async function findProductByUrl(accountId: string, url: string): Promise<ProductRow | null> {
  const ws = await requireWorkspace(accountId);
  const p = ws.products.find((x) => x.url === url);
  return p ? withOpenCounts(ws, [p])[0] : null;
}

export async function insertProduct(row: Omit<ProductRow, "id" | "created_at" | "last_checked_at" | "open_alerts">): Promise<ProductRow> {
  const product: ProductRow = { ...row, id: uid(), created_at: now(), last_checked_at: null };
  return mutate(row.account_id, (ws) => {
    const dup = ws.products.find((p) => p.url === row.url);
    if (dup) return dup;
    ws.products.push(product);
    return product;
  });
}

// Product, first price point, and seeded rules in one workspace write.
export async function insertProductBundle(
  row: Omit<ProductRow, "id" | "created_at" | "last_checked_at" | "open_alerts">,
  price: { price: number; currency: string | null; source: string } | null,
  specs: RuleSpec[],
): Promise<{ product: ProductRow; rules: RuleRow[]; existing: boolean }> {
  const product: ProductRow = { ...row, id: uid(), created_at: now(), last_checked_at: null };
  const rules: RuleRow[] = specs.map((s) => ({ ...s, id: uid(), account_id: row.account_id, product_id: product.id, last_run_at: null, last_hash: null, last_headline: null, created_at: now() }));
  return mutate(row.account_id, (ws) => {
    const dup = ws.products.find((p) => p.url === row.url);
    if (dup) return { product: dup, rules: ws.rules.filter((r) => r.product_id === dup.id), existing: true };
    ws.products.push(product);
    ws.rules.push(...rules);
    if (price) ws.prices.push({ id: uid(), product_id: product.id, price: price.price, currency: price.currency, source: price.source, at: now() });
    return { product, rules, existing: false };
  });
}

// Merges seller overrides; null clears a field. Returns the updated product.
export async function updateProductOverrides(accountId: string, id: string, patch: Partial<ProductOverrides>): Promise<ProductRow> {
  return mutate(accountId, (ws) => {
    const p = ws.products.find((x) => x.id === id);
    if (!p) throw new Error(`Product ${id} not found`);
    const next: ProductOverrides = { ...(p.overrides ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (v === null) delete (next as Record<string, unknown>)[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    p.overrides = Object.keys(next).length ? next : null;
    return { ...p, open_alerts: ws.alerts.filter((a) => a.product_id === p.id && a.status === "new").length };
  });
}

export async function setCompareCache(accountId: string, id: string, result: CompetitorListings): Promise<void> {
  await mutate(accountId, (ws) => {
    const p = ws.products.find((x) => x.id === id);
    if (p) p.compare_cache = { at: now(), result };
  });
}

export async function setProductDutyRate(accountId: string, id: string, rate: HtsRateResult | null): Promise<void> {
  await mutate(accountId, (ws) => {
    const p = ws.products.find((x) => x.id === id);
    if (p) p.duty_rate = rate;
  });
}

export async function saveNexusVerification(accountId: string, v: NexusVerification): Promise<void> {
  await mutate(accountId, (ws) => {
    ws.nexus_verifications = { ...(ws.nexus_verifications ?? {}), [v.state]: v };
  });
}

export async function listNexusVerifications(accountId: string): Promise<Record<string, NexusVerification>> {
  const ws = await requireWorkspace(accountId);
  return ws.nexus_verifications ?? {};
}

export async function deleteProduct(accountId: string, id: string): Promise<void> {
  await mutate(accountId, (ws) => {
    ws.products = ws.products.filter((p) => p.id !== id);
    ws.rules = ws.rules.filter((r) => r.product_id !== id);
    ws.alerts = ws.alerts.filter((a) => a.product_id !== id);
    ws.prices = ws.prices.filter((p) => p.product_id !== id);
    ws.skills = ws.skills.filter((s) => s.product_id !== id);
  });
}

export async function touchProduct(id: string, patch: Partial<Pick<ProductRow, "last_checked_at" | "price" | "currency">>, accountId?: string): Promise<void> {
  const owner = accountId ?? (await findOwner(id));
  if (!owner) return;
  await mutate(owner, (ws) => {
    const p = ws.products.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  });
}

// Rules

export async function insertRules(accountId: string, productId: string, specs: RuleSpec[]): Promise<RuleRow[]> {
  const rows: RuleRow[] = specs.map((s) => ({ ...s, id: uid(), account_id: accountId, product_id: productId, last_run_at: null, last_hash: null, last_headline: null, created_at: now() }));
  return mutate(accountId, (ws) => {
    ws.rules.push(...rows);
    return rows;
  });
}

export async function listRules(productId: string, accountId?: string): Promise<RuleRow[]> {
  const owner = accountId ?? (await findOwner(productId));
  if (!owner) return [];
  const ws = await requireWorkspace(owner);
  return ws.rules.filter((r) => r.product_id === productId);
}

export async function listRulesForAccount(accountId: string): Promise<RuleRow[]> {
  const ws = await requireWorkspace(accountId);
  return [...ws.rules];
}

export async function updateRule(id: string, patch: Partial<Pick<RuleRow, "last_run_at" | "last_hash" | "last_headline" | "cadence_hours" | "paused">>, accountId?: string): Promise<RuleRow | null> {
  const owner = accountId ?? (await findOwnerByRule(id));
  if (!owner) return null;
  return mutate(owner, (ws) => {
    const r = ws.rules.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
    return r ?? null;
  });
}

// Reseeds a product's rules from fresh specs, keyed by rule.key: rules whose key
// still exists keep their id, schedule, hash, and last finding (only the spec
// fields are refreshed), new keys are added, missing keys are removed along
// with nothing else (alerts keep pointing at their rule id even if it is gone).
export async function reseedRules(accountId: string, productId: string, specs: RuleSpec[]): Promise<{ rules: RuleRow[]; added: number; removed: number; kept: number }> {
  return mutate(accountId, (ws) => {
    const mine = ws.rules.filter((r) => r.product_id === productId);
    const byKey = new Map(mine.map((r) => [r.key, r]));
    const wanted = new Set(specs.map((s) => s.key));
    let added = 0;
    let kept = 0;
    const next: RuleRow[] = [];
    for (const s of specs) {
      const existing = byKey.get(s.key);
      if (existing) {
        Object.assign(existing, { title: s.title, query: s.query, include_domains: s.include_domains, include_domains_mode: s.include_domains_mode, state: s.state, seed_note: s.seed_note, family: s.family });
        next.push(existing);
        kept += 1;
      } else {
        next.push({ ...s, id: uid(), account_id: accountId, product_id: productId, last_run_at: null, last_hash: null, last_headline: null, created_at: now() });
        added += 1;
      }
    }
    const removed = mine.filter((r) => !wanted.has(r.key)).length;
    ws.rules = [...ws.rules.filter((r) => r.product_id !== productId), ...next];
    return { rules: next, added, removed, kept };
  });
}

// Alerts

function decorate(ws: Workspace, alerts: AlertRow[]): AlertRow[] {
  const products = new Map(ws.products.map((p) => [p.id, p.title]));
  const rules = new Map(ws.rules.map((r) => [r.id, r.title]));
  return alerts.map((a) => ({ ...a, product_title: products.get(a.product_id), rule_title: rules.get(a.rule_id) }));
}

export async function insertAlert(row: Omit<AlertRow, "id" | "created_at" | "product_title" | "rule_title">): Promise<AlertRow> {
  const alert: AlertRow = { ...row, id: uid(), created_at: now() };
  return mutate(row.account_id, (ws) => {
    ws.alerts.push(alert);
    return decorate(ws, [alert])[0];
  });
}

export async function listAlerts(accountId: string, status: "new" | "dismissed" | "actioned" | "all" = "new", productId?: string): Promise<AlertRow[]> {
  const ws = await requireWorkspace(accountId);
  let rows = ws.alerts.filter((a) => (status === "all" ? true : a.status === status));
  if (productId) rows = rows.filter((a) => a.product_id === productId);
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return decorate(ws, rows.slice(0, 200));
}

export async function getAlert(accountId: string, id: string): Promise<AlertRow | null> {
  const ws = await requireWorkspace(accountId);
  const a = ws.alerts.find((x) => x.id === id);
  return a ? decorate(ws, [a])[0] : null;
}

export async function updateAlert(id: string, patch: Partial<Pick<AlertRow, "status" | "dismiss_reason">>, accountId?: string): Promise<AlertRow> {
  const owner = accountId ?? (await findOwnerByAlert(id));
  if (!owner) throw new Error("Alert not found");
  return mutate(owner, (ws) => {
    const a = ws.alerts.find((x) => x.id === id);
    if (!a) throw new Error("Alert not found");
    Object.assign(a, patch);
    return decorate(ws, [a])[0];
  });
}

// One write for a whole check run: rule bookkeeping, new alerts, last_checked_at.
export interface CheckBatch {
  productId: string;
  lastCheckedAt: string;
  rulePatches: Array<{ id: string; patch: Partial<Pick<RuleRow, "last_run_at" | "last_hash" | "last_headline">> }>;
  alerts: AlertRow[];
}

export async function applyCheckBatch(accountId: string, batch: CheckBatch): Promise<AlertRow[]> {
  return mutate(accountId, (ws) => {
    for (const { id, patch } of batch.rulePatches) {
      const r = ws.rules.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    }
    for (const a of batch.alerts) if (!ws.alerts.some((x) => x.id === a.id)) ws.alerts.push(a);
    const p = ws.products.find((x) => x.id === batch.productId);
    if (p) p.last_checked_at = batch.lastCheckedAt;
    return decorate(ws, batch.alerts);
  });
}

export async function countOpenAlerts(accountId: string): Promise<number> {
  const ws = await requireWorkspace(accountId);
  return ws.alerts.filter((a) => a.status === "new").length;
}

export async function alertExistsForRuleHash(ruleId: string, hash: string, accountId?: string): Promise<boolean> {
  const owner = accountId ?? (await findOwnerByRule(ruleId));
  if (!owner) return false;
  const ws = await requireWorkspace(owner);
  return ws.alerts.some((a) => a.rule_id === ruleId && a.impact?.hash === hash);
}

// Check runs: live progress for one check, written as its own small blob so the
// product page (or the extension) can poll it while the check is still running.
// Not part of the workspace document, so progress writes never contend with it.

export type CheckScope = "all" | "due" | "tariff" | "safety" | "tax" | "policy";
export type CheckItemStatus = "queued" | "checking" | "clear" | "unchanged" | "alert" | "error";

export type IngestStepKey = "read" | "classify" | "seed";

export interface CheckRunRecord {
  id: string;
  account_id: string;
  /** Empty while an ingest has not created the product yet. */
  product_id: string;
  kind: "check" | "ingest";
  scope: CheckScope;
  /** Ingest only: Reading listing, Classifying, Seeding rules. */
  steps?: Array<{ key: IngestStepKey; label: string; status: "queued" | "active" | "done" | "error"; detail?: string }>;
  /** Set when the run failed, so the poller can show the reason even if the request itself was lost. */
  error?: string | null;
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  /** Domains being read right now, for the "Checked 5 of 11: cpsc.gov" line. */
  current: string[];
  items: Array<{ rule_id: string; title: string; family: RuleFamily; domain: string; status: CheckItemStatus; alert_id?: string; error?: string }>;
  conflicts: number;
  started_at: string;
  finished_at: string | null;
}

const checkRunPath = (accountId: string, id: string) => `checkruns/${accountId}/${id}.json`;

export async function saveCheckRun(run: CheckRunRecord): Promise<void> {
  requireDb();
  await put(checkRunPath(run.account_id, run.id), JSON.stringify(run), { ...ACCESS, addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 0 });
}

export async function getCheckRun(accountId: string, id: string): Promise<CheckRunRecord | null> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
  return readBlob<CheckRunRecord>(checkRunPath(accountId, id));
}

// Runs (cost receipt)

export async function insertRun(row: Omit<RunRow, "id" | "created_at">): Promise<void> {
  const run: RunRow = { ...row, id: uid(), created_at: now() };
  await mutate(row.account_id, (ws) => {
    ws.runs.push(run);
    if (ws.runs.length > MAX_RUNS) ws.runs = ws.runs.slice(-MAX_RUNS);
  });
}

export async function listRuns(accountId: string): Promise<RunRow[]> {
  const ws = await requireWorkspace(accountId);
  return [...ws.runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Skills learned from dismissals

export async function insertSkill(row: Omit<SkillRow, "id" | "created_at">): Promise<SkillRow> {
  const skill: SkillRow = { ...row, id: uid(), created_at: now() };
  return mutate(row.account_id, (ws) => {
    ws.skills.push(skill);
    return skill;
  });
}

export async function listSkills(accountId: string, productId?: string): Promise<SkillRow[]> {
  const ws = await requireWorkspace(accountId);
  const rows = [...ws.skills].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return productId ? rows.filter((s) => s.scope !== "product" || s.product_id === productId) : rows;
}

export async function deleteSkill(accountId: string, id: string): Promise<void> {
  await mutate(accountId, (ws) => {
    ws.skills = ws.skills.filter((s) => s.id !== id);
  });
}

export async function updateSkill(accountId: string, id: string, patch: Partial<Pick<SkillRow, "text" | "scope">>): Promise<SkillRow | null> {
  return mutate(accountId, (ws) => {
    const s = ws.skills.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
    return s ?? null;
  });
}

// Token rotation: a new token file is written first, the account switches to
// it, then the old file is removed so the old token stops working.
export async function rotateToken(accountId: string): Promise<AccountRow> {
  const fresh = newToken();
  await store().tokenSet(fresh, accountId);
  let old: string | null = null;
  const account = await mutate(accountId, (ws) => {
    old = ws.account.token;
    ws.account.token = fresh;
    return ws.account;
  });
  if (old && old !== fresh) await store().tokenDel(old);
  return account;
}

// Daily quota on paid endpoints (limits.ts). Returns the decision; when allowed
// the counter is already incremented.
export async function consumeQuota(accountId: string, kind: LimitKind, cost = 1): Promise<QuotaDecision> {
  const limit = limitFor(kind);
  const key = usageKey(kind);
  return mutate(accountId, (ws) => {
    ws.account.usage = pruneUsage(ws.account.usage ?? {});
    const used = ws.account.usage[key] ?? 0;
    const decision = decideQuota(kind, used, limit, cost);
    if (decision.allowed) ws.account.usage[key] = used + cost;
    return decision;
  });
}

// Rule Forge records

export async function insertForge(row: ForgeRow): Promise<ForgeRow> {
  return mutate(row.account_id, (ws) => {
    ws.forges = ws.forges ?? [];
    ws.forges.push(row);
    if (ws.forges.length > 100) ws.forges = ws.forges.slice(-100);
    return row;
  });
}

export async function listForges(accountId: string, productId?: string): Promise<ForgeRow[]> {
  const ws = await requireWorkspace(accountId);
  const titles = new Map(ws.products.map((p) => [p.id, p.title]));
  let rows = [...(ws.forges ?? [])];
  if (productId) rows = rows.filter((f) => f.product_id === productId);
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rows.map((f) => ({ ...f, product_title: titles.get(f.product_id) }));
}

export async function getForge(accountId: string, id: string): Promise<ForgeRow | null> {
  const ws = await requireWorkspace(accountId);
  const f = (ws.forges ?? []).find((x) => x.id === id);
  if (!f) return null;
  return { ...f, product_title: ws.products.find((p) => p.id === f.product_id)?.title };
}

export async function deleteForge(accountId: string, id: string): Promise<void> {
  await mutate(accountId, (ws) => {
    ws.forges = (ws.forges ?? []).filter((f) => f.id !== id);
  });
}

// Price history

export async function insertPrice(row: { account_id: string; product_id: string; price: number; currency: string | null; source: string; at?: string }): Promise<void> {
  const price: PriceRow = { id: uid(), product_id: row.product_id, price: row.price, currency: row.currency, source: row.source, at: row.at ?? now() };
  await mutate(row.account_id, (ws) => {
    ws.prices.push(price);
  });
}

export async function listPrices(productId: string, accountId?: string): Promise<PriceRow[]> {
  const owner = accountId ?? (await findOwner(productId));
  if (!owner) return [];
  const ws = await requireWorkspace(owner);
  return ws.prices.filter((p) => p.product_id === productId).sort((a, b) => a.at.localeCompare(b.at));
}

// Owner lookups for callers that only hold a child id. The pipeline always
// passes accountId, so these are fallbacks and scan the account index.

async function scanOwner(pred: (ws: Workspace) => boolean): Promise<string | null> {
  for (const id of await listAccountIds()) {
    const ws = await loadWorkspace(id);
    if (ws && pred(ws)) return id;
  }
  return null;
}
const findOwner = (productId: string) => scanOwner((ws) => ws.products.some((p) => p.id === productId));
const findOwnerByRule = (ruleId: string) => scanOwner((ws) => ws.rules.some((r) => r.id === ruleId));
const findOwnerByAlert = (alertId: string) => scanOwner((ws) => ws.alerts.some((a) => a.id === alertId));
