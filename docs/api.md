# Shop Rules API

The web app in `apps/web` serves a JSON API under `/api`. The Chrome extension in `extension/` and any script can call it. Every response is JSON. Errors return `{ "error": "message" }` with a 4xx or 5xx status.

## Authentication

Every account is a workspace. The web app creates one on first visit and stores its id in the `sr_account` cookie. The Settings page shows the account token.

API clients send the token in a header:

```
X-SR-Token: sr_live_...
```

The browser app uses the cookie; the extension uses the header. Both resolve to the same account. CORS is open for `/api/*` so the extension can call it from any origin.

## Endpoints

### `GET /api/health`
Returns `{ ok: true, tavily_mode: "keyed" | "keyless", nemotron_configured: boolean, version: string }`.

### `GET /api/account`
Returns `{ account: { id, token, telegram_configured, settings } }`. Settings: `{ ship_to_states: string[], target_margin_pct: number, unit_cost_pct: number, units_per_week: number, state_sales: Record<string, number>, currency: string }`.

### `PATCH /api/account`
Body: partial `{ settings, telegram_chat_id }`. Returns the updated account.

### `GET /api/lookup?url=<listing url>`
Cheap lookup used by the extension on hover. Returns `{ watched: boolean, product: Product | null, marketplace: string, families_preview: string[] }`. Does not call Tavily or Nemotron.

### `POST /api/products`
Body: `{ url: string, page?: { title?, price?, currency?, description?, materials?, image?: string } }`.
The server runs Tavily Extract on the URL, merges any `page` fields the extension scraped from the DOM, classifies the product with Nemotron Nano, and seeds the watch rules. Returns `{ product, rules, meter }`. If the listing already exists for this account the existing product is returned with `existing: true`.

### `GET /api/products`
Returns `{ products: Product[] }` with the newest first. Each product includes `open_alerts` (count) and `last_checked_at`.

### `GET /api/products/:id`
Returns `{ product, rules, alerts, price_history, skills }`.

### `DELETE /api/products/:id`
Stops watching. Returns `{ ok: true }`.

### `POST /api/products/:id/check`
Runs every due rule for the product now (set `{ force: true }` to ignore cadence). For each rule: Tavily Search on official domains, Tavily Extract on the top pages, Nemotron Ultra decides whether the change touches the product and drafts the action, the verifier drops any claim whose quote is not in the extracted text. Returns `{ alerts: Alert[], checked: number, meter }`.

### `GET /api/alerts?status=new|dismissed|actioned|all`
Returns `{ alerts: Alert[] }` newest first, each with `product_title`, `family`, `rule_title`.

### `GET /api/alerts/:id`
Returns `{ alert, product, rule, sources }`.

### `PATCH /api/alerts/:id`
Body: `{ status: "dismissed" | "actioned" | "new", reason?: string }`. A dismissal with a reason asks Nemotron Nano to write a one-line skill ("ignore cosmetic changes on cbp.gov for this product") that is injected into future checks. Returns `{ alert, skill? }`.

### `POST /api/compare`
Body: `{ title: string, price?: number, marketplace?: string, url?: string }`. Tavily Search across Amazon, Etsy, Walmart, and eBay for the same product, Nemotron Nano parses prices. Returns `CompetitorListings`: `{ listings: [{ title, marketplace, price, currency, url, seller }], price_position, note, meter }`.

### `GET /api/rules`
Returns `{ rules: Rule[] }` for every product in the workspace, each with `product_title`.

### `GET /api/receipt`
Cost receipt for the account: `{ runs: Run[], totals: { tavily_calls, tavily_credits, llm_cost_usd, all_ultra_cost_usd, saved_usd, saved_pct }, by_tier: {...} }`.

### `POST /api/cron/check`
Protected by `Authorization: Bearer $CRON_SECRET`. Runs due rules for every account (Vercel Cron calls it on a schedule). Returns counts.

### `POST /api/demo/seed`
Loads three sample listings for the current account and runs one check. Returns `{ products, alerts }`.

## Types

```ts
type Product = {
  id: string; account_id: string; url: string; marketplace: "etsy" | "shopify" | "amazon" | "other";
  title: string; price: number | null; currency: string | null; image_url: string | null;
  profile: ProductProfile; // see apps/web/src/lib/schemas.ts
  created_at: string; last_checked_at: string | null; open_alerts?: number;
};

type Rule = {
  id: string; product_id: string; family: "tariff" | "safety" | "tax" | "policy";
  key: string; title: string; query: string; include_domains: string[]; cadence_hours: number;
  state: string | null; seed_note: string | null; last_run_at: string | null; last_hash: string | null;
};

type Alert = {
  id: string; product_id: string; rule_id: string; status: "new" | "dismissed" | "actioned";
  family: "tariff" | "safety" | "tax" | "policy"; severity: "high" | "medium" | "low";
  headline: string; relevance: "affects" | "might_affect";
  claims: Array<{ claim: string; quote: string; source_url: string; backed: boolean; matched_url: string | null }>;
  proposed: number; backed: number; rejected: number;
  impact: { severity; effective_date: string | null; tariff_rate_change_pct: number | null; estimated_cost_change_pct: number | null };
  action: { type: "reprice" | "compliance_step" | "register_tax" | "review" | "none"; title: string; steps: string[]; suggested_price: number | null; rationale: string };
  sources: Array<{ url: string; title: string; domain: string }>;
  created_at: string;
};

type PricePoint = { at: string; price: number; currency: string | null; source: "listing" | "extension" | "check" };
```
