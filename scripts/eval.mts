// Accuracy eval for the rule checker: golden cases in scripts/eval-cases.json,
// the production prompt (buildRuleCheckPrompt), the real verifier, and the
// deterministic guardrails. Scores relevance, duty points, effective date, and
// action type, then writes docs/EVAL.md. Live runs call Nemotron on Nebius and
// cost money; run once before submission.
//
//   set -a && . ./apps/web/.env.local && set +a && npx -y tsx@4.19.4 scripts/eval.mts [--tier ultra|super|nano] [--only id,id]
//   npx -y tsx@4.19.4 scripts/eval.mts --offline      (no model: replays the simulated outputs through verifier + guardrails)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as plNs from "../apps/web/src/lib/pipeline";
import * as nmNs from "../apps/web/src/lib/nemotron";
import * as scNs from "../apps/web/src/lib/schemas";
import * as vfNs from "../apps/web/src/lib/verifier";
import * as snNs from "../apps/web/src/lib/sanity";
import type { RuleCheck } from "../apps/web/src/lib/schemas";

// tsx compiles the web app's modules to CommonJS (no "type": "module" there), so
// named exports arrive under `default`. Unwrap once, like scripts/facts.mts does.
const unwrap = <T,>(m: T): T => ((m as { default?: T }).default ?? m) as T;
const { buildRuleCheckPrompt } = unwrap(plNs);
const { chatJSON, MODELS } = unwrap(nmNs);
const { RuleCheckSchema, newMeter } = unwrap(scNs);
const { verifyClaims } = unwrap(vfNs);
const { auditRuleCheck } = unwrap(snNs);

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const offline = args.includes("--offline");
const tier = (args.includes("--tier") ? args[args.indexOf("--tier") + 1] : "ultra") as "nano" | "super" | "ultra";
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;

interface Case {
  id: string;
  what: string;
  product: string;
  rule: { family: "tariff" | "safety" | "tax" | "policy"; title: string; query: string; state: string | null; seed_note: string | null; include_domains: string[]; include_domains_mode: "strict" | "prefer" };
  sources: Array<{ url: string; title: string; published_date?: string; text: string }>;
  expected: { relevance: string[]; tariff_rate_change_pct?: number | null; effective_date?: string | null; action_type?: string[] };
  simulated: RuleCheck;
}
interface Fixture {
  products: Record<string, { title: string; price: number; currency: string; marketplace: string; profile: Record<string, unknown> }>;
  cases: Case[];
}

const fixture = JSON.parse(readFileSync(join(here, "eval-cases.json"), "utf8")) as Fixture;
const today = new Date().toISOString().slice(0, 10);

interface Row {
  id: string;
  pass: boolean;
  fields: Record<string, { expected: string; got: string; ok: boolean }>;
  guardrails: string[];
  dropped: boolean;
  ms: number;
}

function fmt(v: unknown): string {
  return v === null || v === undefined ? "null" : String(v);
}

async function runCase(c: Case): Promise<Row> {
  const p = fixture.products[c.product];
  const product = { title: p.title, price: p.price, currency: p.currency, marketplace: p.marketplace as "etsy" | "shopify" | "amazon" | "other", profile: p.profile as never };
  const prompt = buildRuleCheckPrompt({ product, rule: c.rule, skills: [], history: "", sources: c.sources, today });
  const meter = newMeter();
  const started = Date.now();
  const raw: RuleCheck = offline
    ? c.simulated
    : await chatJSON(tier, { name: "rule_check", purpose: `eval ${c.id}`, schema: RuleCheckSchema, maxTokens: 1600, temperature: 0.1, system: prompt.system, user: prompt.user }, meter);
  if (raw.impact.effective_date === today) raw.impact.effective_date = null;
  const verified = verifyClaims(raw.claims, c.sources.map((s) => ({ url: s.url, text: s.text })));
  const audit = auditRuleCheck({ check: raw, verified: verified.claims, rule: c.rule, product, previous: [], today });
  const finalRelevance = audit.drop ? "no_change" : audit.check.relevance;
  const finalRate = audit.drop ? null : audit.check.impact.tariff_rate_change_pct;
  const finalDate = audit.drop ? null : audit.check.impact.effective_date;
  const finalAction = audit.drop ? "none" : audit.check.action.type;

  const fields: Row["fields"] = {};
  fields.relevance = { expected: c.expected.relevance.join("|"), got: finalRelevance, ok: c.expected.relevance.includes(finalRelevance) };
  if ("tariff_rate_change_pct" in c.expected) {
    const e = c.expected.tariff_rate_change_pct ?? null;
    fields.duty_pts = { expected: fmt(e), got: fmt(finalRate), ok: e === null ? finalRate === null : finalRate !== null && Math.abs(finalRate - e) <= 0.1 };
  }
  if ("effective_date" in c.expected) {
    const e = c.expected.effective_date ?? null;
    fields.effective_date = { expected: fmt(e), got: fmt(finalDate), ok: e === finalDate };
  }
  if (c.expected.action_type) fields.action = { expected: c.expected.action_type.join("|"), got: finalAction, ok: c.expected.action_type.includes(finalAction) };
  const pass = Object.values(fields).every((f) => f.ok);
  totalCost += meter.llm.reduce((s, l) => s + l.cost_usd, 0);
  return { id: c.id, pass, fields, guardrails: audit.issues.map((i) => i.code), dropped: audit.drop, ms: Date.now() - started };
}

let totalCost = 0;

async function main(): Promise<void> {
  const cases = fixture.cases.filter((c) => !only || only.has(c.id));
  const rows: Row[] = [];
  for (const c of cases) {
    const row = await runCase(c);
    rows.push(row);
    const detail = Object.entries(row.fields)
      .map(([k, f]) => `${k}=${f.got}${f.ok ? "" : ` (want ${f.expected})`}`)
      .join(", ");
    console.log(`${row.pass ? "PASS" : "FAIL"}  ${row.id.padEnd(28)} ${detail}${row.guardrails.length ? `  guardrails: ${row.guardrails.join(",")}` : ""}`);
  }
  const passed = rows.filter((r) => r.pass).length;
  const byField = new Map<string, { ok: number; n: number }>();
  for (const r of rows) for (const [k, f] of Object.entries(r.fields)) {
    const b = byField.get(k) ?? { ok: 0, n: 0 };
    b.n += 1;
    if (f.ok) b.ok += 1;
    byField.set(k, b);
  }
  const intervened = rows.filter((r) => r.guardrails.length).length;
  console.log(`\n${passed}/${rows.length} cases pass. ${intervened} verdicts adjusted or dropped by guardrails. Model cost $${totalCost.toFixed(4)}.`);

  const mode = offline ? "offline (simulated model outputs replayed through the verifier and guardrails)" : `live, ${MODELS[tier]} on Nebius Token Factory`;
  const md = [
    "# Rule checker eval",
    "",
    `Generated by \`scripts/eval.mts\` at ${new Date().toISOString()}. Mode: ${mode}.`,
    "",
    "Golden cases live in `scripts/eval-cases.json`: realistic excerpts in the style of the official sites, with known answers. Each case runs the production prompt, the quote verifier, and the deterministic guardrails (`apps/web/src/lib/sanity.ts`), then scores relevance, duty points, effective date, and action type. Traps are included on purpose: a notice about another heading or country on the right site, an old 2019 action, a crib rule shown to a toy, and a two-rate quote whose point change must be the difference.",
    "",
    `**${passed} of ${rows.length} cases pass.** Guardrails adjusted or dropped ${intervened} verdict${intervened === 1 ? "" : "s"}. Model cost for the run: $${totalCost.toFixed(4)}.`,
    "",
    "| Field | Accuracy |",
    "| --- | --- |",
    ...Array.from(byField.entries()).map(([k, b]) => `| ${k} | ${b.ok}/${b.n} |`),
    "",
    "| Case | Result | Relevance | Duty pts | Effective date | Action | Guardrails | ms |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((r) => {
      const f = (k: string) => (r.fields[k] ? `${r.fields[k].got}${r.fields[k].ok ? "" : ` (want ${r.fields[k].expected})`}` : "");
      return `| ${r.id} | ${r.pass ? "pass" : "FAIL"} | ${f("relevance")} | ${f("duty_pts")} | ${f("effective_date")} | ${f("action")} | ${r.guardrails.join(", ") || ""} | ${r.ms} |`;
    }),
    "",
    "What each case tests:",
    "",
    ...cases.map((c) => `- \`${c.id}\`: ${c.what}`),
    "",
  ].join("\n");
  writeFileSync(join(root, "docs", offline ? "EVAL.offline.md" : "EVAL.md"), md);
  console.log(`Wrote docs/${offline ? "EVAL.offline.md" : "EVAL.md"}`);
  process.exit(passed === rows.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
