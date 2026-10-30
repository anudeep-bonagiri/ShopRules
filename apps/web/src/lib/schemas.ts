import { z } from "zod";
import { HTS_HEADING_CODES } from "./hts-catalog";

// Structured output the product classifier (Nemotron Nano) must return.
export const ProductProfileSchema = z.object({
  title: z.string(),
  brand: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  category: z.string(),
  product_type: z.string(),
  materials: z.array(z.string()).max(8),
  origin_country: z.string().nullable(),
  intended_for_children: z.boolean(),
  is_cosmetic: z.boolean(),
  is_electronic: z.boolean(),
  has_battery: z.boolean(),
  is_textile: z.boolean(),
  is_food_contact: z.boolean(),
  is_supplement_or_food: z.boolean(),
  hts_candidates: z
    .array(
      z.object({
        code: z.string(),
        description: z.string(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(3),
  keywords: z.array(z.string()).max(8),
  summary: z.string(),
  /** Free-text 6 or 8 digit refinement from the model. Suggested only; verify with a broker. */
  hts_detail: z.string().nullable().optional(),
  /** True when the catalog guardrail overrode or capped the model's heading. */
  hts_guarded: z.boolean().optional(),
});
export type ProductProfile = z.infer<typeof ProductProfileSchema>;

// What the classifier is asked to return: the same facts, but the tariff heading
// is an enum over the curated catalog so the model cannot invent a heading.
export const ClassifierOutputSchema = ProductProfileSchema.omit({ hts_candidates: true, hts_detail: true, hts_guarded: true }).extend({
  hts_heading: z.enum(HTS_HEADING_CODES),
  hts_alternatives: z.array(z.enum(HTS_HEADING_CODES)).max(2),
  hts_confidence: z.number().min(0).max(1),
  hts_detail: z.string().nullable(),
});
export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

// Structured output the rule checker (Nemotron Ultra) must return for one watch rule.
export const RuleCheckSchema = z.object({
  relevance: z.enum(["affects", "might_affect", "no_change"]),
  headline: z.string(),
  claims: z
    .array(
      z.object({
        claim: z.string(),
        quote: z.string(),
        source_url: z.string(),
      }),
    )
    .max(6),
  impact: z.object({
    severity: z.enum(["high", "medium", "low"]),
    effective_date: z.string().nullable(),
    tariff_rate_change_pct: z.number().nullable(),
    estimated_cost_change_pct: z.number().nullable(),
    /** Sales-tax rules only: the economic nexus threshold as the quote states it. null elsewhere. */
    nexus: z
      .object({
        dollars: z.number().nullable(),
        transactions: z.number().nullable(),
        operator: z.enum(["or", "and"]).nullable(),
      })
      .nullable(),
  }),
  action: z.object({
    type: z.enum(["reprice", "compliance_step", "register_tax", "review", "none"]),
    title: z.string(),
    steps: z.array(z.string()).max(6),
    rationale: z.string(),
  }),
});
export type RuleCheck = z.infer<typeof RuleCheckSchema>;

// Structured output for the extension's "compare" panel.
export const CompetitorListingsSchema = z.object({
  listings: z
    .array(
      z.object({
        title: z.string(),
        marketplace: z.string(),
        price: z.number().nullable(),
        currency: z.string().nullable(),
        url: z.string(),
        seller: z.string().nullable(),
      }),
    )
    .max(6),
  price_position: z.enum(["below_market", "at_market", "above_market", "unknown"]),
  note: z.string(),
});
export type CompetitorListings = z.infer<typeof CompetitorListingsSchema>;

// Structured output when a seller dismisses an alert: a reusable skill line.
export const SkillSchema = z.object({
  skill: z.string(),
  scope: z.enum(["product", "family", "account"]),
});
export type Skill = z.infer<typeof SkillSchema>;

export type Marketplace = "etsy" | "shopify" | "amazon" | "other";
export type RuleFamily = "tariff" | "safety" | "tax" | "policy";

export interface VerifiedClaim {
  claim: string;
  quote: string;
  source_url: string;
  backed: boolean;
  matched_url: string | null;
}

export interface Meter {
  tavily_calls: number;
  tavily_credits: number;
  llm: Array<{
    tier: "nano" | "super" | "ultra";
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    ms: number;
    cost_usd: number;
    purpose: string;
  }>;
  started_at: number;
}

export function newMeter(): Meter {
  return { tavily_calls: 0, tavily_credits: 0, llm: [], started_at: Date.now() };
}
