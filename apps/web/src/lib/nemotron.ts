import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { ZodTypeAny, z } from "zod";
import type { Meter } from "./schemas";
import { offlineMode } from "./offline";
import { cannedChatJSON } from "./canned";

// NVIDIA Nemotron 3 on Nebius Token Factory through the OpenAI-compatible API.
// Nano handles the fast, cheap calls (extraction, classification, skills).
// Ultra handles the one hard reasoning step (does this rule touch this product?).

export type Tier = "nano" | "super" | "ultra";

export const MODELS: Record<Tier, string> = {
  nano: process.env.NEMOTRON_NANO || "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  super: process.env.NEMOTRON_SUPER || "nvidia/nemotron-3-super-120b-a12b",
  ultra: process.env.NEMOTRON_ULTRA || "nvidia/Nemotron-3-Ultra-550b-a55b",
};

// USD per 1M tokens. Estimates for the cost receipt; override with env vars
// NEMOTRON_PRICE_<TIER>_IN / _OUT once you read the live Token Factory price list.
export const PRICES_PER_M: Record<Tier, { in: number; out: number }> = {
  nano: {
    in: num(process.env.NEMOTRON_PRICE_NANO_IN, 0.06),
    out: num(process.env.NEMOTRON_PRICE_NANO_OUT, 0.24),
  },
  super: {
    in: num(process.env.NEMOTRON_PRICE_SUPER_IN, 0.3),
    out: num(process.env.NEMOTRON_PRICE_SUPER_OUT, 0.9),
  },
  ultra: {
    in: num(process.env.NEMOTRON_PRICE_ULTRA_IN, 1.0),
    out: num(process.env.NEMOTRON_PRICE_ULTRA_OUT, 3.0),
  },
};

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v ? n : d;
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.NEBIUS_API_KEY) {
    throw new Error("NEBIUS_API_KEY is not set. Get one at tokenfactory.nebius.com (promo code NEBIUS-DEVPOST-GLOBAL26).");
  }
  if (!client) {
    client = new OpenAI({
      baseURL: process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1/",
      apiKey: process.env.NEBIUS_API_KEY,
    });
  }
  return client;
}

export function nemotronConfigured(): boolean {
  return Boolean(process.env.NEBIUS_API_KEY);
}

export function costUsd(tier: Tier, promptTokens: number, completionTokens: number): number {
  const p = PRICES_PER_M[tier];
  return (promptTokens * p.in + completionTokens * p.out) / 1_000_000;
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJson(text: string): string {
  const cleaned = stripThinking(text);
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return cleaned.slice(start, end + 1);
  return cleaned;
}

export interface ChatJsonOptions<S extends ZodTypeAny> {
  system: string;
  user: string;
  schema: S;
  name: string;
  purpose: string;
  maxTokens?: number;
  temperature?: number;
  thinking?: boolean;
}

export async function chatJSON<S extends ZodTypeAny>(tier: Tier, opts: ChatJsonOptions<S>, meter?: Meter): Promise<z.infer<S>> {
  if (offlineMode().models === "canned") return cannedChatJSON(tier, opts, meter);
  const openai = getClient();
  const model = MODELS[tier];
  const started = Date.now();
  // Nemotron 3 is a reasoning model. With thinking on, a long prompt can spend
  // the whole completion budget on reasoning and return empty content, so
  // thinking is off by default and the prompts carry the structure instead.
  // Set NEMOTRON_ULTRA_THINKING=1 to let Ultra reason before the rule decision.
  const thinking = opts.thinking ?? (tier === "ultra" && process.env.NEMOTRON_ULTRA_THINKING === "1");
  const base: Record<string, unknown> = {
    model,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? (thinking ? 6000 : 1800),
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    chat_template_kwargs: { enable_thinking: thinking },
  };

  let content = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  try {
    const res = await openai.chat.completions.create({
      ...base,
      response_format: zodResponseFormat(opts.schema, opts.name),
    } as unknown as ChatCompletionCreateParamsNonStreaming);
    content = res.choices[0]?.message?.content ?? "";
    usage = res.usage ?? undefined;
    if (!content.trim()) throw new Error("empty content from json_schema mode");
  } catch (err) {
    // Some models reject strict json_schema or return nothing; fall back to json_object with the schema in the prompt.
    const res = await openai.chat.completions.create({
      ...base,
      messages: [
        { role: "system", content: `${opts.system}\n\nReturn only a JSON object.` },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_object" },
    } as unknown as ChatCompletionCreateParamsNonStreaming);
    content = res.choices[0]?.message?.content ?? "";
    usage = res.usage ?? undefined;
    if (!content.trim()) throw err;
  }

  const ms = Date.now() - started;
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  if (meter) {
    meter.llm.push({
      tier,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      ms,
      cost_usd: costUsd(tier, promptTokens, completionTokens),
      purpose: opts.purpose,
    });
  }

  let raw = extractJson(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A truncated or malformed body is rare but not free to surface: one more try with a bigger budget.
    const retry = await openai.chat.completions.create({
      ...base,
      max_tokens: Math.max(Number(base.max_tokens) * 2, 2400),
      messages: [
        { role: "system", content: `${opts.system}\n\nReturn only a compact JSON object, no prose.` },
        { role: "user", content: opts.user },
      ],
      response_format: { type: "json_object" },
    } as unknown as ChatCompletionCreateParamsNonStreaming);
    const retryContent = retry.choices[0]?.message?.content ?? "";
    const rp = retry.usage?.prompt_tokens ?? 0;
    const rc = retry.usage?.completion_tokens ?? 0;
    if (meter) meter.llm.push({ tier, model, prompt_tokens: rp, completion_tokens: rc, ms: Date.now() - started - ms, cost_usd: costUsd(tier, rp, rc), purpose: `${opts.purpose} (retry)` });
    raw = extractJson(retryContent);
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Nemotron ${tier} returned non-JSON for ${opts.name}: ${raw.slice(0, 200)}`);
    }
  }
  const result = opts.schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Nemotron ${tier} output failed schema ${opts.name}: ${result.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  }
  return result.data;
}

export async function chatText(tier: Tier, system: string, user: string, meter?: Meter, purpose = "text"): Promise<string> {
  const openai = getClient();
  const model = MODELS[tier];
  const started = Date.now();
  const res = await openai.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 800,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    chat_template_kwargs: { enable_thinking: false },
  } as unknown as ChatCompletionCreateParamsNonStreaming);
  const ms = Date.now() - started;
  const promptTokens = res.usage?.prompt_tokens ?? 0;
  const completionTokens = res.usage?.completion_tokens ?? 0;
  if (meter) {
    meter.llm.push({ tier, model, prompt_tokens: promptTokens, completion_tokens: completionTokens, ms, cost_usd: costUsd(tier, promptTokens, completionTokens), purpose });
  }
  return stripThinking(res.choices[0]?.message?.content ?? "");
}
