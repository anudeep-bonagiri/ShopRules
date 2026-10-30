// Measures one full Shop Rules cycle against the live APIs and writes
// docs/FACTS.md and docs/FACTS.json. Every number on the Devpost page comes
// from this file. Run from the repo root with the web app's env loaded:
//
//   set -a && . ./apps/web/.env.local && set +a && npx -y tsx@4.19.4 scripts/facts.mts
//
// It creates a throwaway workspace, watches one real listing (page fields are
// passed the way the extension sends them), runs the first rule checks, forges
// one check as code, scores the verifier against the planted fixture under
// seed/ (this file is the only reader of seed/fixtures/answer_key.json), writes
// docs/FACTS.json, docs/FACTS.md and docs/RESULTS.md, and deletes the workspace
// (set KEEP_WORKSPACE=1 to keep it). Nothing here reads a key into the output.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as dbNs from "../apps/web/src/lib/db";
import * as plNs from "../apps/web/src/lib/pipeline";
import * as fgNs from "../apps/web/src/lib/forge";
import * as nmNs from "../apps/web/src/lib/nemotron";
import * as sbNs from "../apps/web/src/lib/sandbox";
import * as tvNs from "../apps/web/src/lib/tavily";
import * as vfNs from "../apps/web/src/lib/verifier";

const pick = (ns: unknown) => ((ns as { default?: unknown }).default ?? ns) as Record<string, any>;
const db = pick(dbNs);
const pl = pick(plNs);
const fg = pick(fgNs);
const nm = pick(nmNs);
const sb = pick(sbNs);
const tv = pick(tvNs);
const vf = pick(vfNs);

const asOf = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
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

// Verifier self-check: the planted fixture and its answer key, read here only.
const fxSources = JSON.parse(readFileSync("seed/fixtures/verifier_sources.json", "utf8")) as Array<{ url: string; text: string }>;
const fxClaims = JSON.parse(readFileSync("seed/fixtures/verifier_claims.json", "utf8")) as Array<{ id: string; claim: string; quote: string; source_url: string }>;
const fxKey = JSON.parse(readFileSync("seed/fixtures/answer_key.json", "utf8")) as Array<{ id: string; kind: "planted" | "decoy"; class: string; expected: "backed" | "rejected"; note: string }>;
const vres = vf.verifyClaims(fxClaims.map((c) => ({ claim: c.claim, quote: c.quote, source_url: c.source_url })), fxSources.map((x) => ({ url: x.url, text: x.text })));
const backedById = new Map<string, boolean>(fxClaims.map((c, i) => [c.id, Boolean(vres.claims[i].backed)]));
const keyRows = fxKey.map((k) => ({ ...k, backed: backedById.get(k.id) ?? false, pass: (backedById.get(k.id) ?? false) === (k.expected === "backed") }));
const plantedRows = keyRows.filter((k) => k.kind === "planted");
const decoyRows = keyRows.filter((k) => k.kind === "decoy");
const verifier = {
  fixture_pages: fxSources.length,
  fixture_claims: fxKey.length,
  planted: plantedRows.length,
  planted_rejected: plantedRows.filter((k) => !k.backed).length,
  planted_backed: plantedRows.filter((k) => k.backed).map((k) => ({ id: k.id, class: k.class, note: k.note })),
  decoys: decoyRows.length,
  decoys_backed: decoyRows.filter((k) => k.backed).length,
  decoys_rejected: decoyRows.filter((k) => !k.backed).map((k) => ({ id: k.id, class: k.class, note: k.note })),
  by_class: keyRows.map((k) => ({ id: k.id, kind: k.kind, class: k.class, expected: k.expected, backed: k.backed, pass: k.pass, note: k.note })),
};

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
    test_functions: fg.countTestFunctions(forge.tests),
    sandbox_note: forge.sandbox_note,
    last_output: forge.last_output,
    llm_cost_usd: forge.llm_cost_usd,
    tavily_calls: forge.tavily_calls,
  },
  cost: { llm_usd: cost, all_ultra_usd: allUltra, saved_pct: allUltra > 0 ? ((allUltra - cost) / allUltra) * 100 : 0, by_tier: byTier, forge_llm_usd: forge.llm_cost_usd },
  verifier,
  account_id: account.id,
};

mkdirSync("docs", { recursive: true });
writeFileSync("docs/FACTS.json", JSON.stringify(facts, null, 2));

const f = facts;
const md = `# FACTS

Generated by \`scripts/facts.mts\` at ${asOf}. One real cycle against the live APIs. Every number on the Devpost page is copied from here.

## Setup
- Models: Nano \`${f.models.nano}\`, Super \`${f.models.super}\`, Ultra \`${f.models.ultra}\` on Nebius Token Factory
- Tavily mode: ${f.tavily_mode}; store: ${db.storeName()}
- Sandbox: ${f.sandbox.configured ? `configured, image ${f.sandbox.image}` : "not configured in this run"}
- Listing: ${f.listing.marketplace}, "${f.listing.title}", price ${f.listing.price}

## Ingest (Tavily Extract plus Nemotron Nano)
- Wall time: ${f.ingest.ms} ms (${(f.ingest.ms / 1000).toFixed(1)} s)
- Origin detected: ${f.ingest.origin_country}; top HTS candidate: ${f.ingest.hts_top?.code ?? "none"} (${f.ingest.hts_top ? Math.round(f.ingest.hts_top.confidence * 100) : 0}% confidence); for children: ${f.ingest.intended_for_children}
- Rules seeded: ${f.ingest.rules_seeded} (${Object.entries(f.ingest.rules_by_family).map(([k, v]) => `${k} ${v}`).join(", ")})
- Tavily calls: ${f.ingest.tavily_calls}; Nemotron calls: ${f.ingest.llm.map((c: any) => `${c.tier} ${c.prompt_tokens}/${c.completion_tokens} tokens in ${c.ms} ms`).join("; ")}

## First check (Tavily Search plus Extract, Nemotron Ultra, verifier)
- Wall time: ${f.check.ms} ms (${(f.check.ms / 1000).toFixed(1)} s) for ${f.check.rules_checked} rules run three at a time
- Alerts: ${f.check.alerts}; unchanged rules skipped: ${f.check.unchanged}; errors: ${f.check.errors.length}
- Claims: ${f.check.claims_proposed} proposed, ${f.check.claims_backed} backed by the extracted source text, ${f.check.claims_rejected} rejected by the verifier
- Source domains read: ${f.check.source_domains.join(", ") || "none"}
- Official (.gov) domains among them: ${f.check.official_domains.length} of ${f.check.source_domains.length}
- Tavily calls: ${f.check.tavily_calls}; Nemotron calls: ${f.check.llm.map((c: any) => `${c.tier} ${c.prompt_tokens}/${c.completion_tokens} tokens in ${c.ms} ms`).join("; ")}
${f.check.alerts_summary.map((a: any) => `- Alert: [${a.family}, ${a.severity}, ${a.relevance}] ${a.headline} (action ${a.action}, ${a.backed}/${a.proposed} backed, effective ${a.effective_date ?? "n/a"})`).join("\n")}

## Rule Forge (coding agent)
- Rule: ${forgeRule.title}; fact extracted: ${f.forge.fact_name}
- Status: ${f.forge.status}; iterations: ${f.forge.iterations}; wall time: ${f.forge.ms} ms (${(f.forge.ms / 1000).toFixed(1)} s)
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

## Verifier self-check (seed/fixtures; the answer key is read by this script only)
- Fixture: ${f.verifier.fixture_claims} claims over ${f.verifier.fixture_pages} synthetic pages; ${f.verifier.planted} planted misquotes, ${f.verifier.decoys} decoys that look wrong but are legitimate quotes
- Planted misquotes rejected: ${f.verifier.planted_rejected} of ${f.verifier.planted}${f.verifier.planted_backed.length ? `; let through: ${f.verifier.planted_backed.map((k: any) => `${k.class} (${k.note})`).join("; ")}` : ""}
- Decoys accepted: ${f.verifier.decoys_backed} of ${f.verifier.decoys}${f.verifier.decoys_rejected.length ? `; wrongly rejected: ${f.verifier.decoys_rejected.map((k: any) => `${k.class} (${k.note})`).join("; ")}` : ""}
- By class: ${f.verifier.by_class.map((k: any) => `${k.class} ${k.pass ? "pass" : "FAIL"}`).join(", ")}

## Caveats
- The fixture pages under seed/ are synthetic and live on the reserved .invalid domain; they exist to score the verifier, not to stand in for any regulation.
- The listing URL is a stand-in Etsy URL with the page fields supplied the way the extension sends them; Tavily Extract on the URL itself may return nothing for a fake listing, so the classifier worked from the supplied fields plus whatever Extract returned.
- Thresholds in the rule catalog are seeds; every alert above quotes the live page.
- The verifier checks that a quote exists in the extracted text, not that it means what the model says. Rejected claims stay visible in the UI.
`;
writeFileSync("docs/FACTS.md", md);

const history = existsSync("docs/RESULTS_HISTORY.md") ? readFileSync("docs/RESULTS_HISTORY.md", "utf8").trim() : "(no history yet)";
const sandboxLine = f.forge.sandbox_note ? `did not run (${f.forge.sandbox_note})` : `ran on ${f.sandbox.image}`;
const results = `# RESULTS

Run of ${asOf}. Rerun: \`scripts/full_run.sh\` (one measured cycle against the live APIs: \`scripts/facts.mts\`, then \`scripts/honesty.py\`).

## Metrics

| Metric | Result | Target |
| --- | --- | --- |
| Planted misquotes rejected by the verifier (fixture) | ${f.verifier.planted_rejected} of ${f.verifier.planted} | ${f.verifier.planted} of ${f.verifier.planted} |
| Decoy quotes accepted by the verifier (fixture) | ${f.verifier.decoys_backed} of ${f.verifier.decoys} | ${f.verifier.decoys} of ${f.verifier.decoys} |
| Claims backed on the live check | ${f.check.claims_backed} of ${f.check.claims_proposed} (${f.check.claims_rejected} rejected and shown) | every alert carries at least one backed quote |
| Official (.gov) source domains on the tariff rules | ${f.check.official_domains.length} of ${f.check.source_domains.length} | ${f.check.source_domains.length} of ${f.check.source_domains.length} |
| First check wall time, ${f.check.rules_checked} rules | ${(f.check.ms / 1000).toFixed(1)} s | under 20 s |
| Ingest wall time | ${(f.ingest.ms / 1000).toFixed(1)} s | under 30 s |
| Nemotron spend, ingest plus check | $${f.cost.llm_usd.toFixed(4)} | under $0.05 |
| Rule Forge | ${f.forge.status}, ${f.forge.code_lines} lines, ${f.forge.test_functions} tests, ${(f.forge.ms / 1000).toFixed(1)} s | tests pass in the sandbox |

## Hard negatives (decoys that look wrong and are legitimate)

| Id | Class | What it looks like | Verifier |
| --- | --- | --- | --- |
${f.verifier.by_class.filter((k: any) => k.kind === "decoy").map((k: any) => `| ${k.id} | ${k.class} | ${k.note} | ${k.backed ? "backed" : "rejected (wrong)"} |`).join("\n")}

## Planted misquotes

| Id | Class | What was planted | Verifier |
| --- | --- | --- | --- |
${f.verifier.by_class.filter((k: any) => k.kind === "planted").map((k: any) => `| ${k.id} | ${k.class} | ${k.note} | ${k.backed ? "backed (let through)" : "rejected"} |`).join("\n")}

## Provenance

| Integration | This run |
| --- | --- |
| Tavily Search and Extract | live, ${f.tavily_mode} mode, ${f.ingest.tavily_calls + f.check.tavily_calls + f.forge.tavily_calls} calls |
| Nemotron 3 Nano and Ultra on Token Factory | live, ${f.ingest.llm.length + f.check.llm.length + f.forge.steps.filter((s: any) => s.model).length} calls |
| Token Factory Sandbox | ${sandboxLine} |
| Workspace store | ${db.storeName()} |

Nothing in this run was replayed, recorded, or stubbed.

## Cost

Nemotron: $${f.cost.llm_usd.toFixed(4)} for ingest plus check, $${f.cost.forge_llm_usd.toFixed(4)} for the forge; the same tokens on Ultra only: $${f.cost.all_ultra_usd.toFixed(4)}; saved by routing ${f.cost.saved_pct.toFixed(0)}%.

## What is real

<!-- honesty:start -->
<!-- honesty:end -->

## History

${history}

## Caveat

The listing is a stand-in Etsy URL with page fields supplied the way the extension sends them. The fixture pages under seed/ are synthetic and live on the reserved .invalid domain; they score the verifier and nothing else. The verifier checks that a quote is on the page, not that it means what the model says.
`;
writeFileSync("docs/RESULTS.md", results);
console.log(md);
if (process.env.KEEP_WORKSPACE) console.log("workspace", account.id, "kept");
else {
  await db.deleteAccount(account.id);
  console.log("workspace", account.id, "deleted");
}
