import { del, get, list, put } from "@vercel/blob";
import postgres from "postgres";
import type { Marketplace, ProductProfile, RuleFamily, VerifiedClaim } from "./schemas";
import type { RuleSpec } from "./rules-catalog";

// Server-only data layer. Each workspace (account) is one private JSON document
// in Vercel Blob. Every write creates a new immutable version file under
// accounts/<id>/ and the newest version is resolved through the listing API,
// which is consistent right after a write (overwriting one pathname is not:
// reads can lag by seconds). Old versions are pruned in the background.
// Swap this file for a SQL implementation if you self-host; apps/web/supabase/
// migration.sql has the equivalent schema.

export interface AccountRow {
  id: string;
  token: string;
  telegram_chat_id: string | null;
  settings: { ship_to_states?: string[]; target_margin_pct?: number; currency?: string; unit_cost_pct?: number; units_per_week?: number; state_sales?: Record<string, number> };
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
  extracted_text: string | null;
  created_at: string;
  last_checked_at: string | null;
  open_alerts?: number;
}

export interface RuleRow extends RuleSpec {
  id: string;
  account_id: string;
  product_id: string;
  last_run_at: string | null;
  last_hash: string | null;
  last_headline: string | null;
  created_at: string;
}

export interface AlertRow {
  id: string;
  account_id: string;
  product_id: string;
  rule_id: string;
  status: "new" | "dismissed" | "actioned";
  family: RuleFamily;
  severity: "high" | "medium" | "low";
  relevance: "affects" | "might_affect";
  headline: string;
  claims: VerifiedClaim[];
  proposed: number;
  backed: number;
  rejected: number;
  impact: { severity: string; effective_date: string | null; tariff_rate_change_pct: number | null; estimated_cost_change_pct: number | null; hash?: string };
  action: { type: string; title: string; steps: string[]; suggested_price: number | null; rationale: string };
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
}

const ACCESS = { access: "private" as const };
const MAX_RUNS = 400;
const KEEP_VERSIONS = 3;

// Two document stores share one interface. Postgres (DATABASE_URL) is the
// default when set: one row per workspace, read in one query, written with an
// optimistic version check. Vercel Blob (BLOB_READ_WRITE_TOKEN) keeps immutable
// versions and lists them to find the newest, which Vercel bills as an advanced
// operation per read and suspends on the Hobby plan past a threshold (D-12).

interface DocStore {
  name: "postgres" | "blob";
  load(id: string): Promise<Workspace | null>;
  save(id: string, ws: Workspace): Promise<void>;
  remove(id: string, token: string | null): Promise<void>;
  ids(): Promise<string[]>;
  tokenGet(token: string): Promise<string | null>;
  tokenSet(token: string, accountId: string): Promise<void>;
}

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL || process.env.BLOB_READ_WRITE_TOKEN);
}

export function storeName(): "postgres" | "blob" | "none" {
  if (process.env.DATABASE_URL) return "postgres";
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  return "none";
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
  name: "postgres",
  async load(id) {
    const rows = await sql()<Array<{ doc: Workspace | string }>>`select doc from workspaces where id = ${id}`;
    const doc = rows[0]?.doc;
    if (doc == null) return null;
    return typeof doc === "string" ? (JSON.parse(doc) as Workspace) : doc;
  },
  async save(id, ws) {
    const rows = await sql()<Array<{ id: string }>>`
      insert into workspaces (id, doc, version, updated_at)
      values (${id}, ${sql().json(ws as unknown as postgres.JSONValue)}, ${ws.version}, now())
      on conflict (id) do update
        set doc = excluded.doc, version = excluded.version, updated_at = now()
        where workspaces.version < excluded.version
      returning id`;
    if (!rows.length) throw new Error(`Workspace ${id} changed underneath this write (version ${ws.version})`);
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
};

// Vercel Blob store

const accountDir = (id: string) => `accounts/${id}/`;
const legacyPath = (id: string) => `accounts/${id}.json`;
const tokenPath = (token: string) => `tokens/${token}.json`;

function versionName(id: string): string {
  const stamp = String(Date.now()).padStart(14, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${accountDir(id)}${stamp}-${rand}.json`;
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
  name: "blob",
  async load(id) {
    const versions = await listVersions(id);
    const newest = versions.at(-1);
    if (newest) return readBlob<Workspace>(newest.url);
    // Workspaces created before versioning lived at accounts/<id>.json.
    return readBlob<Workspace>(legacyPath(id));
  },
  async save(id, ws) {
    await put(versionName(id), JSON.stringify(ws), { ...ACCESS, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 0 });
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
    await put(tokenPath(token), JSON.stringify({ account_id: accountId }), { ...ACCESS, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 0 });
  },
};

function store(): DocStore {
  requireDb();
  return process.env.DATABASE_URL ? pgStore : blobStore;
}

// Workspace documents

async function loadWorkspace(id: string): Promise<Workspace | null> {
  return store().load(id);
}

async function writeWorkspace(id: string, ws: Workspace): Promise<void> {
  ws.version = (ws.version ?? 0) + 1;
  await store().save(id, ws);
}

async function mutate<T>(accountId: string, fn: (ws: Workspace) => T | Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const ws = await loadWorkspace(accountId);
      if (!ws) throw new Error(`Workspace ${accountId} not found`);
      const result = await fn(ws);
      await writeWorkspace(accountId, ws);
      return result;
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && /not found/i.test(err.message)) throw err;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
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
  await writeWorkspace(id, fresh);
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
  return products.map((p) => ({ ...p, open_alerts: counts.get(p.id) ?? 0 }));
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

export async function updateRule(id: string, patch: Partial<Pick<RuleRow, "last_run_at" | "last_hash" | "last_headline" | "cadence_hours">>, accountId?: string): Promise<void> {
  const owner = accountId ?? (await findOwnerByRule(id));
  if (!owner) return;
  await mutate(owner, (ws) => {
    const r = ws.rules.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
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

export async function insertPrice(row: { account_id: string; product_id: string; price: number; currency: string | null; source: string }): Promise<void> {
  const price: PriceRow = { id: uid(), product_id: row.product_id, price: row.price, currency: row.currency, source: row.source, at: now() };
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
