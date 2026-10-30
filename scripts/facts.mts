// Measures one full Shop Rules cycle against the live APIs and writes
// docs/FACTS.md and docs/FACTS.json. Every number on the Devpost page comes
// from this file. Run from the repo root with the web app's env loaded:
//
//   set -a && . ./apps/web/.env.local && set +a && npx -y tsx@4.19.4 scripts/facts.mts
//
// It creates a throwaway workspace, watches one real listing (page fields are
// passed the way the extension sends them), runs the first rule checks, forges
// one check as code, and records what happened. Nothing here reads a key into
// the output.

import { mkdirSync, writeFileSync } from "node:fs";
import * as dbNs from "../apps/web/src/lib/db";
import * as plNs from "../apps/web/src/lib/pipeline";
import * as fgNs from "../apps/web/src/lib/forge";
import * as nmNs from "../apps/web/src/lib/nemotron";
import * as sbNs from "../apps/web/src/lib/sandbox";
import * as tvNs from "../apps/web/src/lib/tavily";

const pick = (ns: unknown) => ((ns as { default?: unknown }).default ?? ns) as Record<string, any>;
const db = pick(dbNs);
const pl = pick(plNs);
const fg = pick(fgNs);
const nm = pick(nmNs);
const sb = pick(sbNs);
const tv = pick(tvNs);

const asOf = new Date().toISOString();
const account = await db.getOrCreateAccount(crypto.randomUUID());

const listing = {
  url: "https://www.etsy.com/listing/1458123456/wooden-rainbow-stacker-toy",
  page: {
    title: "Wooden Rainbow Stacker Toy, Montessori Stacking Blocks for Toddlers 1-3",
    price: 34,
    currency: "USD",
    description: "Handmade beech wood stacking rainbow, 7 pieces, finished with water-based non-toxic paint. For ages 12 months and up. Made in China, shipped from our Texas studio.",
    materials: ["beech wood", "water-based paint"],
    image: null,
  },
};

const t0 = Date.now();
const ingest = await pl.ingestProduct(account, listing.url, listing.page);
const ingestMs = Date.now() - t0;

const t1 = Date.now();
const check = await pl.runChecks(account, ingest.product, { force: true, maxRules: 4 });
const checkMs = Date.now() - t1;

const rules = await db.listRules(ingest.product.id, account.id);
const forgeRule = rules.find((r: any) => r.key === "tariff-deminimis") ?? rules[0];
const t2 = Date.now();
const forge = await fg.forgeCheck(account, ingest.product, forgeRule, { maxIterations: 3 });
const forgeMs = Date.now() - t2;

const llm = [...ingest.meter.llm, ...check.meter.llm];
const byTier: Record<string, { calls: number; prompt: number; completion: number; ms: number; cost: number }> = {};
for (const c of llm) {
  const t = (byTier[c.tier] ??= { calls: 0, prompt: 0, completion: 0, ms: 0, cost: 0 });
  t.calls += 1;
  t.prompt += c.prompt_tokens;
  t.completion += c.completion_tokens;
  t.ms += c.ms;
  t.cost += c.cost_usd;
}
const cost = llm.reduce((s, c) => s + c.cost_usd, 0);
const allUltra = llm.reduce((s, c) => s + (c.prompt_tokens * nm.PRICES_PER_M.ultra.in + c.completion_tokens * nm.PRICES_PER_M.ultra.out) / 1_000_000, 0);
const claims = check.alerts.flatMap((a: any) => a.claims);
const domains = Array.from(new Set(check.alerts.flatMap((a: any) => a.sources.map((s: any) => s.domain)))).sort();
const officialDomains = domains.filter((d: string) => /\.gov$|\.gov\./.test(d));

const facts = {
  asOf,
  models: nm.MODELS,
  prices_per_million: nm.PRICES_PER_M,
  tavily_mode: tv.tavilyMode(),
  sandbox: { configured: sb.sandboxConfigured(), image: sb.sandboxImage() },
  listing: { marketplace: ingest.product.marketplace, title: ingest.product.title, price: ingest.product.price },
  ingest: {
    ms: ingestMs,
    origin_country: ingest.product.profile.origin_country,
    hts_top: ingest.product.profile.hts_candidates[0] ?? null,
    intended_for_children: ingest.product.profile.intended_for_children,
    rules_seeded: ingest.rules.length,
    rules_by_family: ingest.rules.reduce((m: Record<string, number>, r: any) => ((m[r.family] = (m[r.family] ?? 0) + 1), m), {}),
    tavily_calls: ingest.meter.tavily_calls,
    llm: ingest.meter.llm.map((c: any) => ({ tier: c.tier, prompt_tokens: c.prompt_tokens, completion_tokens: c.completion_tokens, ms: c.ms })),
  },
  check: {
    ms: checkMs,
    rules_checked: check.checked,
    unchanged: check.skipped_unchanged,
    alerts: check.alerts.length,
    errors: check.errors,
    claims_proposed: claims.length,
    claims_backed: claims.filter((c: any) => c.backed).length,
    claims_rejected: claims.filter((c: any) => !c.backed).length,
    source_domains: domains,
    official_domains: officialDomains,
    tavily_calls: check.meter.tavily_calls,
    llm: check.meter.llm.map((c: any) => ({ tier: c.tier, prompt_tokens: c.prompt_tokens, completion_tokens: c.completion_tokens, ms: c.ms })),
    alerts_summary: check.alerts.map((a: any) => ({ family: a.family, severity: a.severity, relevance: a.relevance, headline: a.headline, action: a.action.type, backed: a.backed, proposed: a.proposed, effective_date: a.impact.effective_date })),
  },
  forge: {
    ms: forgeMs,
    status: forge.status,
    iterations: forge.iterations,
    fact_name: forge.fact_name,
    steps: forge.steps.map((s: any) => ({ kind: s.kind, title: s.title, ms: s.ms ?? null, model: s.model ?? null, ok: s.ok ?? null })),
    code_lines: forge.code.split("\n").length,
    test_functions: (forge.tests.match(/^def (test_|assert_|check_)/gm) ?? []).length,
    sandbox_note: forge.sandbox_note,
    last_output: forge.last_output,
    llm_cost_usd: forge.llm_cost_usd,
    tavily_calls: forge.tavily_calls,
  },
  cost: { llm_usd: cost, all_ultra_usd: allUltra, saved_pct: allUltra > 0 ? ((allUltra - cost) / allUltra) * 100 : 0, by_tier: byTier, forge_llm_usd: forge.llm_cost_usd },
  account_id: account.id,
};

mkdirSync("docs", { recursive: true });
writeFileSync("docs/FACTS.json", JSON.stringify(facts, null, 2));

const f = facts;
const md = `# FACTS

Generated by \`scripts/facts.mts\` at ${asOf}. One real cycle against the live APIs. Every number on the Devpost page is copied from here.

## Setup
- Models: Nano \`${f.models.nano}\`, Super \`${f.models.super}\`, Ultra \`${f.models.ultra}\` on Nebius Token Factory
- Tavily mode: ${f.tavily_mode}
- Sandbox: ${f.sandbox.configured ? `configured, image ${f.sandbox.image}` : "not configured in this run"}
- Listing: ${f.listing.marketplace}, "${f.listing.title}", price ${f.listing.price}

## Ingest (Tavily Extract plus Nemotron Nano)
- Wall time: ${f.ingest.ms} ms
- Origin detected: ${f.ingest.origin_country}; top HTS candidate: ${f.ingest.hts_top?.code ?? "none"} (${f.ingest.hts_top ? Math.round(f.ingest.hts_top.confidence * 100) : 0}% confidence); for children: ${f.ingest.intended_for_children}
- Rules seeded: ${f.ingest.rules_seeded} (${Object.entries(f.ingest.rules_by_family).map(([k, v]) => `${k} ${v}`).join(", ")})
- Tavily calls: ${f.ingest.tavily_calls}; Nemotron calls: ${f.ingest.llm.map((c: any) => `${c.tier} ${c.prompt_tokens}/${c.completion_tokens} tokens in ${c.ms} ms`).join("; ")}

## First check (Tavily Search plus Extract, Nemotron Ultra, verifier)
- Wall time: ${f.check.ms} ms for ${f.check.rules_checked} rules run three at a time
- Alerts: ${f.check.alerts}; unchanged rules skipped: ${f.check.unchanged}; errors: ${f.check.errors.length}
- Claims: ${f.check.claims_proposed} proposed, ${f.check.claims_backed} backed by the extracted source text, ${f.check.claims_rejected} rejected by the verifier
- Source domains read: ${f.check.source_domains.join(", ") || "none"}
- Official (.gov) domains among them: ${f.check.official_domains.length} of ${f.check.source_domains.length}
- Tavily calls: ${f.check.tavily_calls}; Nemotron calls: ${f.check.llm.map((c: any) => `${c.tier} ${c.prompt_tokens}/${c.completion_tokens} tokens in ${c.ms} ms`).join("; ")}
${f.check.alerts_summary.map((a: any) => `- Alert: [${a.family}, ${a.severity}, ${a.relevance}] ${a.headline} (action ${a.action}, ${a.backed}/${a.proposed} backed, effective ${a.effective_date ?? "n/a"})`).join("\n")}

## Rule Forge (coding agent)
- Rule: ${forgeRule.title}; fact extracted: ${f.forge.fact_name}
- Status: ${f.forge.status}; iterations: ${f.forge.iterations}; wall time: ${f.forge.ms} ms
- check.py: ${f.forge.code_lines} lines; test functions: ${f.forge.test_functions}
- Steps: ${f.forge.steps.map((s: any) => `${s.kind}${s.model ? ` (${s.model})` : ""} ${s.ms ?? "?"} ms${s.ok === false ? " FAIL" : s.ok ? " PASS" : ""}`).join("; ")}
- Sandbox: ${f.forge.sandbox_note ?? `ran on ${f.sandbox.image}`}
- Result: ${f.forge.last_output ? JSON.stringify(f.forge.last_output).slice(0, 400) : "no sandbox output"}
- Forge cost: $${f.forge.llm_cost_usd.toFixed(4)}; Tavily calls: ${f.forge.tavily_calls}

## Cost of the ingest plus check cycle
- Nemotron spend: $${f.cost.llm_usd.toFixed(4)}
- Same tokens on Ultra only: $${f.cost.all_ultra_usd.toFixed(4)}
- Saved by routing Nano for the fast calls: ${f.cost.saved_pct.toFixed(0)}%
- By tier: ${Object.entries(f.cost.by_tier).map(([k, v]: [string, any]) => `${k} ${v.calls} calls, ${v.prompt + v.completion} tokens, $${v.cost.toFixed(4)}, ${(v.ms / v.calls / 1000).toFixed(1)} s avg`).join("; ")}
- Prices used (USD per 1M tokens in/out): ${Object.entries(f.prices_per_million).map(([k, v]: [string, any]) => `${k} ${v.in}/${v.out}`).join(", ")} (list prices as published by third-party trackers; set NEMOTRON_PRICE_* to your invoice)

## Caveats
- The listing URL is a stand-in Etsy URL with the page fields supplied the way the extension sends them; Tavily Extract on the URL itself may return nothing for a fake listing, so the classifier worked from the supplied fields plus whatever Extract returned.
- Thresholds in the rule catalog are seeds; every alert above quotes the live page.
- The verifier checks that a quote exists in the extracted text, not that it means what the model says. Rejected claims stay visible in the UI.
`;
writeFileSync("docs/FACTS.md", md);
console.log(md);
console.log("workspace", account.id);
