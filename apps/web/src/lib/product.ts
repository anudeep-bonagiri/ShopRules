// Seller overrides on a product. The classifier writes `profile`; the seller
// writes `overrides`; nothing the seller set is ever overwritten by a model.
// Every consumer (rules, pricing, prompts, UI) reads the merged view from here.

import { catalogHeading, headingOf } from "./hts-catalog.ts";
import type { ProductProfile } from "./schemas";
import type { PricingProductLike, PricingSettings } from "./pricing";

export interface ProductOverrides {
  /** Seller's own retail price when the listing price is stale or unknown. */
  price_override?: number | null;
  /** Landed cost per unit, delivered. Wins over the workspace unit_cost_pct. */
  unit_cost?: number | null;
  /** 0..1 share of landed cost that is customs value. */
  dutiable_share?: number | null;
  units_per_week?: number | null;
  /** ISO 3166-1 alpha-2. */
  origin_country?: string | null;
  /** Four-digit heading from the catalog. */
  hts_heading?: string | null;
  /** Free-text 6 or 8 digit refinement; "suggested, verify with a broker". */
  hts_detail?: string | null;
  for_children?: boolean | null;
  materials?: string[] | null;
  /** Country-based duty surcharge the seller pays on this product, percent of customs value (duty-exposure.ts). */
  duty_surcharge_pct?: number | null;
}

export const OVERRIDE_KEYS: Array<keyof ProductOverrides> = ["price_override", "unit_cost", "dutiable_share", "units_per_week", "origin_country", "hts_heading", "hts_detail", "for_children", "materials", "duty_surcharge_pct"];

export interface ProductLike {
  price: number | null;
  profile: ProductProfile;
  overrides?: ProductOverrides | null;
}

/** The profile as the rules and prompts should see it: classifier facts with the seller's corrections on top. */
export function effectiveProfile<T extends ProductLike>(product: T): ProductProfile {
  const o = product.overrides ?? {};
  const profile: ProductProfile = { ...product.profile };
  if (o.origin_country !== undefined && o.origin_country !== null) profile.origin_country = o.origin_country.toUpperCase();
  if (o.for_children !== undefined && o.for_children !== null) profile.intended_for_children = o.for_children;
  if (o.materials && o.materials.length) profile.materials = o.materials.slice(0, 8);
  if (o.hts_heading) {
    const h = catalogHeading(o.hts_heading);
    if (h) {
      const rest = (profile.hts_candidates ?? []).filter((c) => headingOf(c.code) !== h.heading);
      profile.hts_candidates = [{ code: h.heading, description: h.label, confidence: 1 }, ...rest].slice(0, 3);
      profile.hts_guarded = false;
    }
  }
  if (o.hts_detail !== undefined && o.hts_detail !== null) profile.hts_detail = o.hts_detail;
  return profile;
}

/** Retail price to use: the seller's override when set, else the listing price. */
export function effectivePrice(product: ProductLike): number | null {
  const o = product.overrides ?? {};
  if (o.price_override != null && Number.isFinite(o.price_override) && o.price_override > 0) return o.price_override;
  return product.price;
}

/** What pricing.ts needs, with per-product numbers winning over workspace defaults. */
export function pricingProduct(product: ProductLike): PricingProductLike {
  const o = product.overrides ?? {};
  return {
    price: effectivePrice(product),
    unit_cost: o.unit_cost ?? null,
    dutiable_share: o.dutiable_share ?? null,
    units_per_week: o.units_per_week ?? null,
  };
}

/** "Set for this product" vs "Using workspace default", per field, for the UI. */
export function fieldSource(product: ProductLike, key: keyof ProductOverrides): "product" | "default" {
  const v = product.overrides?.[key];
  return v === undefined || v === null || (Array.isArray(v) && v.length === 0) ? "default" : "product";
}

/** Validates a PATCH body into overrides; null clears a field, undefined leaves it alone. */
export function sanitizeOverrides(body: unknown): { patch: Partial<ProductOverrides>; errors: string[] } {
  const errors: string[] = [];
  const patch: Partial<ProductOverrides> = {};
  if (!body || typeof body !== "object") return { patch, errors: ["body must be an object"] };
  const b = body as Record<string, unknown>;
  const num = (k: keyof ProductOverrides, min: number, max: number, int = false) => {
    if (!(k in b)) return;
    const v = b[k];
    if (v === null) {
      (patch as Record<string, unknown>)[k] = null;
      return;
    }
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) {
      errors.push(`${k} must be a number between ${min} and ${max}`);
      return;
    }
    (patch as Record<string, unknown>)[k] = int ? Math.round(n) : n;
  };
  num("price_override", 0.01, 1_000_000);
  num("unit_cost", 0, 1_000_000);
  num("dutiable_share", 0, 1);
  num("units_per_week", 0, 100_000, true);
  num("duty_surcharge_pct", 0, 200);
  if ("origin_country" in b) {
    const v = b.origin_country;
    if (v === null || v === "") patch.origin_country = null;
    else if (typeof v === "string" && /^[A-Za-z]{2}$/.test(v)) patch.origin_country = v.toUpperCase();
    else errors.push("origin_country must be a two-letter country code");
  }
  if ("hts_heading" in b) {
    const v = b.hts_heading;
    if (v === null || v === "") patch.hts_heading = null;
    else if (typeof v === "string" && catalogHeading(v)) patch.hts_heading = headingOf(v);
    else errors.push("hts_heading must be a four-digit heading from the catalog");
  }
  if ("hts_detail" in b) {
    const v = b.hts_detail;
    if (v === null || v === "") patch.hts_detail = null;
    else if (typeof v === "string" && /^\d{4}(\.\d{2}){0,2}(\.\d{2})?$/.test(v.trim())) patch.hts_detail = v.trim();
    else errors.push("hts_detail must look like 9405.20 or 9405.20.60");
  }
  if ("for_children" in b) {
    const v = b.for_children;
    if (v === null || typeof v === "boolean") patch.for_children = v;
    else errors.push("for_children must be true, false, or null");
  }
  if ("materials" in b) {
    const v = b.materials;
    if (v === null) patch.materials = null;
    else if (Array.isArray(v)) patch.materials = v.filter((m): m is string => typeof m === "string").map((m) => m.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 10);
    else if (typeof v === "string") patch.materials = v.split(/[,;|/]/).map((m) => m.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 10);
    else errors.push("materials must be a list of strings");
  }
  return { patch, errors };
}
