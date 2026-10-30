import type { Meter } from "./schemas";

// Thin fetch client over the Tavily REST API. With TAVILY_API_KEY set it uses
// the key; without it, Search and Extract run in Tavily's free keyless mode so a
// demo never dies on a missing key. Map and Crawl need a key.

const BASE = process.env.TAVILY_BASE_URL || "https://api.tavily.com";

function headers(): Record<string, string> {
  const key = process.env.TAVILY_API_KEY;
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (key) h.Authorization = `Bearer ${key}`;
  else h["X-Tavily-Access-Mode"] = "keyless";
  return h;
}

export function tavilyMode(): "keyed" | "keyless" {
  return process.env.TAVILY_API_KEY ? "keyed" : "keyless";
}

export interface TavilySearchParams {
  query: string;
  max_results?: number;
  search_depth?: "basic" | "advanced" | "fast" | "ultra-fast";
  topic?: "general" | "news" | "finance";
  time_range?: "day" | "week" | "month" | "year";
  max_age_hours?: number;
  include_domains?: string[];
  include_domains_mode?: "strict" | "prefer";
  exclude_domains?: string[];
  chunks_per_source?: number;
  include_raw_content?: boolean | "markdown" | "text";
  include_answer?: boolean;
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  raw_content?: string | null;
  published_date?: string;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilyResult[];
  response_time: number;
  answer?: string;
}

export interface TavilyExtractResult {
  url: string;
  raw_content: string;
  title?: string;
  images?: string[];
}

export interface TavilyExtractResponse {
  results: TavilyExtractResult[];
  failed_results: Array<{ url: string; error: string }>;
  response_time: number;
}

async function post<T>(path: string, body: unknown, meter: Meter | undefined, credits: number): Promise<T> {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (meter) {
    meter.tavily_calls += 1;
    meter.tavily_credits += credits;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as T;
  (json as { _ms?: number })._ms = Date.now() - started;
  return json;
}

export async function tavilySearch(params: TavilySearchParams, meter?: Meter): Promise<TavilySearchResponse> {
  const depth = params.search_depth ?? "advanced";
  const credits = depth === "advanced" ? 2 : 1;
  const body: Record<string, unknown> = {
    query: params.query.slice(0, 1400),
    max_results: params.max_results ?? 5,
    search_depth: depth,
    topic: params.topic ?? "general",
    include_answer: params.include_answer ?? false,
  };
  if (params.time_range) body.time_range = params.time_range;
  if (params.max_age_hours) body.max_age_hours = params.max_age_hours;
  if (params.include_domains?.length) {
    body.include_domains = params.include_domains.slice(0, 12);
    if (params.include_domains_mode) body.include_domains_mode = params.include_domains_mode;
  }
  if (params.exclude_domains?.length) body.exclude_domains = params.exclude_domains;
  if (params.chunks_per_source && depth !== "ultra-fast") body.chunks_per_source = params.chunks_per_source;
  if (params.include_raw_content) body.include_raw_content = params.include_raw_content;
  return post<TavilySearchResponse>("/search", body, meter, credits);
}

export async function tavilyExtract(
  urls: string[],
  opts: { query?: string; chunks_per_source?: number; extract_depth?: "basic" | "advanced"; format?: "markdown" | "text" } = {},
  meter?: Meter,
): Promise<TavilyExtractResponse> {
  const clean = Array.from(new Set(urls.filter(Boolean))).slice(0, 10);
  const body: Record<string, unknown> = {
    urls: clean,
    extract_depth: opts.extract_depth ?? "basic",
    format: opts.format ?? "markdown",
  };
  if (opts.query) {
    body.query = opts.query;
    body.chunks_per_source = Math.min(Math.max(opts.chunks_per_source ?? 3, 1), 5);
  }
  const credits = (opts.extract_depth === "advanced" ? 2 : 1) * Math.ceil(clean.length / 5);
  return post<TavilyExtractResponse>("/extract", body, meter, credits);
}

export async function tavilyMap(url: string, opts: { instructions?: string; max_depth?: number; limit?: number } = {}, meter?: Meter) {
  if (tavilyMode() === "keyless") throw new Error("Tavily Map needs TAVILY_API_KEY (keyless mode only covers Search and Extract).");
  return post<{ base_url: string; results: string[] }>(
    "/map",
    { url, instructions: opts.instructions, max_depth: opts.max_depth ?? 1, limit: opts.limit ?? 30 },
    meter,
    1,
  );
}

export async function tavilyCrawl(
  url: string,
  opts: { instructions?: string; max_depth?: number; limit?: number; chunks_per_source?: number } = {},
  meter?: Meter,
) {
  if (tavilyMode() === "keyless") throw new Error("Tavily Crawl needs TAVILY_API_KEY (keyless mode only covers Search and Extract).");
  return post<{ base_url: string; results: Array<{ url: string; raw_content: string }> }>(
    "/crawl",
    {
      url,
      instructions: opts.instructions,
      max_depth: opts.max_depth ?? 1,
      limit: opts.limit ?? 20,
      chunks_per_source: opts.instructions ? (opts.chunks_per_source ?? 3) : undefined,
    },
    meter,
    2,
  );
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
