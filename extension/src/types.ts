import type { PricingResult } from "../../apps/web/src/lib/pricing";
export type { PricingResult };

// Types shared by the background worker, content script, panel, and popup.
// They mirror docs/api.md. Keep them in sync with the web app.

export type Marketplace = "etsy" | "shopify" | "amazon" | "other";
export type RuleFamily = "tariff" | "safety" | "tax" | "policy";
export type Severity = "high" | "medium" | "low";
export type AlertStatus = "new" | "dismissed" | "actioned";
export type PricePosition = "below_market" | "at_market" | "above_market" | "unknown";

export interface ProductProfile {
  title: string;
  brand: string | null;
  price: number | null;
  currency: string | null;
  category: string;
  product_type: string;
  materials: string[];
  origin_country: string | null;
  intended_for_children: boolean;
  is_cosmetic: boolean;
  is_electronic: boolean;
  has_battery: boolean;
  is_textile: boolean;
  is_food_contact: boolean;
  is_supplement_or_food: boolean;
  hts_candidates: Array<{ code: string; description: string; confidence: number }>;
  hts_detail?: string | null;
  hts_guarded?: boolean;
  keywords: string[];
  summary: string;
}

export interface Product {
  id: string;
  account_id: string;
  url: string;
  marketplace: Marketplace;
  title: string;
  price: number | null;
  currency: string | null;
  image_url: string | null;
  profile: ProductProfile;
  overrides?: { price_override?: number | null; unit_cost?: number | null; dutiable_share?: number | null; units_per_week?: number | null; origin_country?: string | null; hts_heading?: string | null; hts_detail?: string | null; for_children?: boolean | null; materials?: string[] | null } | null;
  created_at: string;
  last_checked_at: string | null;
  duty_rate?: { general: string | null; general_pct: number | null; special?: string | null; verified: boolean; label: string; url?: string | null } | null;
  open_alerts?: number;
}

export interface Rule {
  id: string;
  product_id: string;
  family: RuleFamily;
  key: string;
  title: string;
  query: string;
  include_domains: string[];
  cadence_hours: number;
  state: string | null;
  seed_note: string | null;
  last_run_at: string | null;
  last_hash: string | null;
}

export interface Claim {
  claim: string;
  quote: string;
  source_url: string;
  backed: boolean;
  matched_url: string | null;
}

export interface AlertImpact {
  severity: Severity;
  effective_date: string | null;
  tariff_rate_change_pct: number | null;
  estimated_cost_change_pct: number | null;
}

export interface AlertAction {
  type: "reprice" | "compliance_step" | "register_tax" | "review" | "none";
  title: string;
  steps: string[];
  suggested_price: number | null;
  rationale: string;
}

export interface Alert {
  id: string;
  product_id: string;
  rule_id: string;
  status: AlertStatus;
  family: RuleFamily;
  severity: Severity;
  headline: string;
  relevance: "affects" | "might_affect";
  claims: Claim[];
  proposed: number;
  backed: number;
  rejected: number;
  impact: AlertImpact;
  action: AlertAction;
  /** Deterministic reprice math computed by the server from the alert facts. */
  pricing?: PricingResult | null;
  /** rule (default) or price: raised by price tracking. */
  kind?: "rule" | "price";
  price_change?: { old_price: number; new_price: number; delta: number; pct: number } | null;
  guardrails?: Array<{ code: string; severity: string; message: string }>;
  sources: Array<{ url: string; title: string; domain: string }>;
  created_at: string;
  // Present on GET /api/alerts only.
  product_title?: string;
  rule_title?: string;
}

export interface PricePoint {
  at: string;
  price: number;
  currency: string | null;
  source: "listing" | "extension" | "check" | "refresh" | "reprice" | string;
}

export interface Skill {
  skill: string;
  scope: "product" | "family" | "account";
}

export interface CompetitorListing {
  title: string;
  marketplace: string;
  price: number | null;
  currency: string | null;
  url: string;
  seller: string | null;
}

export interface AccountSettings {
  ship_to_states?: string[];
  target_margin_pct?: number;
  currency?: string;
  unit_cost_pct?: number;
  units_per_week?: number;
  state_sales?: Record<string, number>;
  price_change_pct?: number;
  dutiable_share?: number;
}

// Responses

export interface AccountResponse {
  account: {
    id: string;
    token: string;
    telegram_configured: boolean;
    settings: AccountSettings;
  };
}

export interface AlertStatusResponse {
  alert: Alert;
  skill?: Skill;
}

export interface HealthResponse {
  ok: boolean;
  tavily_mode: "keyed" | "keyless";
  nemotron_configured: boolean;
  version: string;
}

export interface LookupResponse {
  watched: boolean;
  product: Product | null;
  marketplace: string;
  families_preview: string[];
}

export interface WatchResponse {
  product: Product;
  rules: Rule[];
  meter?: unknown;
  existing?: boolean;
}

export interface ProductDetailResponse {
  product: Product;
  rules: Rule[];
  alerts: Alert[];
  price_history: PricePoint[];
  skills: Skill[];
}

export interface CheckResponse {
  alerts: Alert[];
  checked: number;
  skipped_unchanged?: number;
  errors?: string[];
  run_id?: string;
  meter?: unknown;
}

// Live progress of a check or an ingest, from GET /api/runs/[id].
export interface RunRecord {
  id: string;
  kind: "check" | "ingest";
  status: "running" | "done" | "failed";
  total: number;
  done: number;
  current: string[];
  items: Array<{ rule_id: string; title: string; family: RuleFamily; domain: string; status: "queued" | "checking" | "clear" | "unchanged" | "alert" | "error"; alert_id?: string }>;
  steps?: Array<{ key: "read" | "classify" | "seed"; label: string; status: "queued" | "active" | "done" | "error"; detail?: string }>;
  error?: string | null;
}

export interface RunResponse {
  run: RunRecord;
}

export interface ProductsResponse {
  products: Product[];
}

export interface ObserveResponse {
  inserted: boolean;
  reason: string;
  previous: number | null;
  alert: Alert | null;
  price_history: PricePoint[];
}

export interface AlertsResponse {
  alerts: Alert[];
}

export interface CompareResponse {
  listings: CompetitorListing[];
  price_position: PricePosition;
  note: string;
  cached?: boolean;
  cached_at?: string;
  meter?: unknown;
}

// Request bodies

export interface PagePayload {
  title?: string;
  price?: number;
  currency?: string;
  description?: string;
  materials?: string[];
  image?: string;
  marketplace?: string;
}

export interface CompareRequest {
  title: string;
  price?: number;
  marketplace?: string;
  url?: string;
  product_id?: string;
  force?: boolean;
}

// Where each extracted field came from; the HUD says "read from page markup, verify" for weak ones.
export type FieldSource = "api" | "json_ld" | "open_graph" | "selectors" | "card" | "text";
export interface FieldConfidence {
  title?: FieldSource;
  price?: FieldSource;
  currency?: FieldSource;
  image?: FieldSource;
  description?: FieldSource;
  materials?: FieldSource;
}

// What the content script scrapes from a listing page or a product card.
export interface PageProduct {
  url: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  description: string | null;
  materials: string[] | null;
  image: string | null;
  confidence?: FieldConfidence;
  /** Shopify .json extras when available. */
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | null;
}

export interface Settings {
  baseUrl: string;
  token: string;
}

// Messages between the content script or popup and the background worker.

export type ApiErrorCode = "unconfigured" | "network" | "auth" | "http" | "internal";

export interface ApiFailure {
  ok: false;
  error: string;
  code: ApiErrorCode;
  status?: number;
}

export type BgResult<T> = { ok: true; data: T } | ApiFailure;

export type BgRequest =
  | { type: "lookup"; url: string }
  | { type: "watch"; url: string; page: PagePayload }
  | { type: "product"; id: string }
  | { type: "compare"; body: CompareRequest }
  | { type: "alerts" }
  | { type: "health" }
  | { type: "check"; id: string; scope?: "due" | "all" | "tariff" | "safety" | "tax" | "policy"; force?: boolean; run_id?: string }
  | { type: "account" }
  | { type: "alertStatus"; id: string; status: AlertStatus; reason?: string }
  | { type: "settings" }
  | { type: "open-popup" }
  | { type: "poll" }
  | { type: "run"; id: string }
  | { type: "observe"; id: string; price: number; currency: string | null; confidence?: number }
  | { type: "patchProduct"; id: string; patch: Record<string, unknown> }
  | { type: "products" }
  | { type: "connect"; token: string; baseUrl: string }
  | { type: "open-url"; url: string };

export interface TabMessage {
  type: "open-panel";
}
