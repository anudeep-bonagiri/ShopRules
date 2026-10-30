import { del, get, list, put } from "@vercel/blob";
import type { Marketplace, ProductProfile, RuleFamily, VerifiedClaim } from "./schemas";
import type { RuleSpec } from "./rules-catalog";

// Server-only data layer. Each workspace (account) is one private JSON document
// in Vercel Blob, read fresh on every request and written back with an ETag
// precondition so two judges clicking at once cannot clobber each other.
// Swap this file for a SQL implementation if you self-host; apps/web/supabase/
// migration.sql has the equivalent schema.

export interface AccountRow {
  id: string;
  token: string;
  telegram_chat_id: string | null;
  settings: { ship_to_states?: string[]; target_margin_pct?: number; currency?: string; unit_cost_pct?: number };
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

interface Workspace {
  version: number;
  account: AccountRow;
  products: ProductRow[];
  rules: RuleRow[];
  alerts: AlertRow[];
  runs: RunRow[];
  skills: SkillRow[];
  prices: PriceRow[];
}

const ACCESS = { access: "private" as const };
const MAX_RUNS = 400;

export function dbConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function requireDb(): void {
  if (!dbConfigured()) throw new Error("Storage is not configured. Set BLOB_READ_WRITE_TOKEN (Vercel Blob) in the environment.");
}

function now(): string {
  return new Date().toISOString();
}

function uid(): string {
  return crypto.randomUUID();
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return "sr_live_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const accountPath = (id: string) => `accounts/${id}.json`;
const tokenPath = (token: string) => `tokens/${token}.json`;

async function readJson<T>(pathname: string): Promise<{ doc: T | null; etag: string | null }> {
  requireDb();
  try {
    const result = await get(pathname, { ...ACCESS, useCache: false });
    if (!result || !result.stream) return { doc: null, etag: null };
    const text = await new Response(result.stream).text();
    return { doc: JSON.parse(text) as T, etag: result.headers?.get?.("etag") ?? null };
  } catch (err) {
    const status = (err as { status?: number }).status;
    const name = (err as { name?: string }).name ?? "";
    if (status === 404 || /NotFound/i.test(name)) return { doc: null, etag: null };
    throw err;
  }
}

async function writeJson(pathname: string, doc: unknown, etag: string | null): Promise<void> {
  requireDb();
  await put(pathname, JSON.stringify(doc), {
    ...ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
    ...(etag ? { ifMatch: etag } : {}),
  });
}

async function loadWorkspace(accountId: string): Promise<{ ws: Workspace | null; etag: string | null }> {
  const { doc, etag } = await readJson<Workspace>(accountPath(accountId));
  return { ws: doc, etag };
}

async function mutate<T>(accountId: string, fn: (ws: Workspace) => T | Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const { ws, etag } = await loadWorkspace(accountId);
    if (!ws) throw new Error(`Workspace ${accountId} not found`);
    const result = await fn(ws);
    ws.version = (ws.version ?? 0) + 1;
    try {
      await writeJson(accountPath(accountId), ws, etag);
      return result;
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      const name = (err as { name?: string }).name ?? "";
      if (status === 412 || /Precondition/i.test(name)) {
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Workspace write conflict");
}

async function requireWorkspace(accountId: string): Promise<Workspace> {
  const { ws } = await loadWorkspace(accountId);
  if (!ws) throw new Error(`Workspace ${accountId} not found`);
  return ws;
}

// Accounts

export async function getOrCreateAccount(id: string): Promise<AccountRow> {
  const { ws } = await loadWorkspace(id);
  if (ws) return ws.account;
  const account: AccountRow = {
    id,
    token: newToken(),
    telegram_chat_id: null,
    settings: { ship_to_states: ["TX", "CA", "NY", "FL"], target_margin_pct: 35, currency: "USD", unit_cost_pct: 45 },
    created_at: now(),
  };
  const fresh: Workspace = { version: 1, account, products: [], rules: [], alerts: [], runs: [], skills: [], prices: [] };
  await writeJson(accountPath(id), fresh, null);
  await writeJson(tokenPath(account.token), { account_id: id }, null);
  return account;
}

export async function getAccountByToken(token: string): Promise<AccountRow | null> {
  if (!/^sr_live_[a-f0-9]{36}$/.test(token)) return null;
  const { doc } = await readJson<{ account_id: string }>(tokenPath(token));
  if (!doc) return null;
  const { ws } = await loadWorkspace(doc.account_id);
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
  requireDb();
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ ...ACCESS, prefix: "accounts/", cursor, limit: 500 });
    for (const b of page.blobs) {
      const m = b.pathname.match(/^accounts\/([^/]+)\.json$/);
      if (m) ids.push(m[1]);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return ids;
}

export async function deleteAccount(id: string): Promise<void> {
  const { ws } = await loadWorkspace(id);
  if (!ws) return;
  await del([accountPath(id), tokenPath(ws.account.token)]);
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
    const { ws } = await loadWorkspace(id);
    if (ws && pred(ws)) return id;
  }
  return null;
}
const findOwner = (productId: string) => scanOwner((ws) => ws.products.some((p) => p.id === productId));
const findOwnerByRule = (ruleId: string) => scanOwner((ws) => ws.rules.some((r) => r.id === ruleId));
const findOwnerByAlert = (alertId: string) => scanOwner((ws) => ws.alerts.some((a) => a.id === alertId));
