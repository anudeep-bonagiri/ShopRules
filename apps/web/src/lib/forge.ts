import { z } from "zod";
import { insertForge, insertRun, listAlerts, newId, type AccountRow, type AlertRow, type ForgeRow, type ForgeStep, type ProductRow, type RuleRow } from "./db";
import { chatJSON, PRICES_PER_M } from "./nemotron";
import { countryName } from "./rules-catalog";
import { newMeter, type Meter } from "./schemas";
import { runInSandbox, sandboxConfigured, sandboxImage } from "./sandbox";
import { tavilyExtract, tavilySearch } from "./tavily";

// Rule Forge: the coding agent. For one product and one watch rule it writes a
// Python check that reads the official source text and returns the one fact the
// rule is about (a duty rate, a threshold, a status, a date) with the quote it
// came from. Nemotron Nano writes the tests from the facts the verifier already
// backed. The sandbox runs them. Ultra revises until they pass or the budget is
// spent. A passing check becomes a deterministic re-check the watch loop can
// run on fresh text without asking a model again.

const WriteSchema = z.object({
  approach: z.string(),
  fact_name: z.string(),
  code: z.string(),
  expected_value: z.string().nullable(),
  expected_quote: z.string().nullable(),
});

const TestSchema = z.object({
  tests_code: z.string(),
  cases: z.array(z.string()).max(6),
});

const ReviseSchema = z.object({
  diagnosis: z.string(),
  code: z.string(),
});

const HARNESS = `import json, sys, traceback, importlib.util
spec = importlib.util.spec_from_file_location("check", "/work/check.py")
check = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(check)
except Exception:
    print(json.dumps({"import_error": traceback.format_exc()[-1500:]}))
    sys.exit(2)
spec_t = importlib.util.spec_from_file_location("tests", "/work/test_check.py")
tests = importlib.util.module_from_spec(spec_t)
try:
    spec_t.loader.exec_module(tests)
except Exception:
    print(json.dumps({"import_error": "tests: " + traceback.format_exc()[-1500:]}))
    sys.exit(2)
results = []
names = [n for n in dir(tests) if (n.startswith("test_") or n.startswith("assert_") or n.startswith("check_")) and callable(getattr(tests, n))]
for name in sorted(names):
    fn = getattr(tests, name)
    try:
        fn()
        results.append({"name": name, "ok": True})
    except AssertionError as e:
        results.append({"name": name, "ok": False, "error": "AssertionError: " + str(e)[:400]})
    except Exception:
        results.append({"name": name, "ok": False, "error": traceback.format_exc()[-600:]})
passed = sum(1 for r in results if r["ok"])
try:
    sources = json.load(open("/work/sources.json"))
    out = check.check(sources)
except Exception:
    out = {"error": traceback.format_exc()[-800:]}
print(json.dumps({"passed": passed, "failed": len(results) - passed, "results": results, "output": out}))
sys.exit(0 if passed == len(results) and results else 1)
`;

interface SourceDoc {
  url: string;
  title: string;
  text: string;
}

async function gatherSources(rule: RuleRow, alert: AlertRow | null, meter: Meter): Promise<SourceDoc[]> {
  const search = await tavilySearch(
    { query: rule.query, search_depth: "advanced", max_results: 4, chunks_per_source: 3, include_domains: rule.include_domains, include_domains_mode: rule.include_domains_mode, time_range: "year" },
    meter,
  );
  const results = (search.results ?? []).filter((r) => r.url && r.content).slice(0, 4);
  const docs: SourceDoc[] = [];
  try {
    const ex = await tavilyExtract(results.map((r) => r.url), { query: rule.query, chunks_per_source: 3 }, meter);
    for (const r of results) {
      const full = ex.results.find((e) => e.url === r.url)?.raw_content;
      docs.push({ url: r.url, title: r.title, text: `${r.content}\n${full ?? ""}`.slice(0, 6000) });
    }
  } catch {
    for (const r of results) docs.push({ url: r.url, title: r.title, text: r.content.slice(0, 6000) });
  }
  // Make sure the quotes the verifier already backed are present in the inputs.
  if (alert) {
    for (const c of alert.claims.filter((x) => x.backed)) {
      const target = docs.find((d) => d.url === (c.matched_url ?? c.source_url));
      if (target && !target.text.includes(c.quote.slice(0, 40))) target.text += `\n${c.quote}`;
      if (!target) docs.push({ url: c.matched_url ?? c.source_url, title: "Backed source", text: c.quote });
    }
  }
  return docs;
}

function step(kind: ForgeStep["kind"], title: string, detail: string, extra: Partial<ForgeStep> = {}): ForgeStep {
  return { kind, title, detail, at: new Date().toISOString(), ...extra };
}

export function countTestFunctions(code: string): number {
  return (code.match(/^def (test_|assert_|check_)\w*\s*\(/gm) ?? []).length;
}

// Indent a module of top-level assertions into one test function the harness can run.
function wrapAsTest(code: string): string {
  const body = code
    .split("\n")
    .map((line) => (line.trim() ? `    ${line}` : ""))
    .join("\n");
  return `def test_module():\n${body}\n`;
}

export async function forgeCheck(account: AccountRow, product: ProductRow, rule: RuleRow, opts: { maxIterations?: number } = {}): Promise<ForgeRow> {
  const meter = newMeter();
  const steps: ForgeStep[] = [];
  const maxIterations = opts.maxIterations ?? 3;
  const alerts = await listAlerts(account.id, "all", product.id);
  const alert = alerts.filter((a) => a.rule_id === rule.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;

  const t0 = Date.now();
  const sources = await gatherSources(rule, alert, meter);
  steps.push(step("sources", `Fetched ${sources.length} official pages with Tavily`, sources.map((s) => s.url).join("\n"), { ms: Date.now() - t0 }));

  const backed = alert ? alert.claims.filter((c) => c.backed) : [];
  const productLine = `${product.title} (${product.marketplace}, ${countryName(product.profile.origin_country)}, HTS candidate ${product.profile.hts_candidates[0]?.code ?? "none"}, price ${product.price ?? "unknown"})`;

  // 1. Write
  const t1 = Date.now();
  const written = await chatJSON(
    "ultra",
    {
      name: "forge_write",
      purpose: `forge write ${rule.key}`,
      schema: WriteSchema,
      maxTokens: 2200,
      temperature: 0.1,
      system: [
        "You are a senior Python engineer writing a small, deterministic compliance check for an online seller.",
        "Write a module that defines `def check(sources: list[dict]) -> dict`. Each source is {url, title, text}. The function must find ONE specific fact the watch rule is about (for example a duty rate, a dollar threshold, an effective date, or whether an exemption is suspended) using only string and regex operations on the text, and return {\"found\": bool, \"value\": str|None, \"quote\": str|None, \"source_url\": str|None, \"fact\": str}.",
        "quote must be an exact substring of the source text that contains the fact. Prefer the most authoritative domain. Never call the network, never import anything beyond re, json, datetime, math.",
        "Keep it under 80 lines, readable, with a short docstring that states what fact it extracts and why it matters for this product.",
        "expected_value and expected_quote: what you expect check() to return on the provided sources, or null if the fact is not present.",
        "Return JSON only.",
      ].join(" "),
      user: `PRODUCT: ${productLine}\nRULE: ${rule.family} | ${rule.title}\nQUERY: ${rule.query}${rule.seed_note ? `\nSEED: ${rule.seed_note}` : ""}\n\nFACTS ALREADY VERIFIED FROM THESE SOURCES:\n${backed.length ? backed.map((c) => `- ${c.claim}\n  quote: "${c.quote}"\n  url: ${c.matched_url ?? c.source_url}`).join("\n") : "(none yet)"}\n\nSOURCES\n${sources.map((s, i) => `--- SOURCE ${i + 1}\nurl: ${s.url}\ntitle: ${s.title}\ntext:\n${s.text.slice(0, 3500)}`).join("\n\n")}`,
    },
    meter,
  );
  let code = written.code;
  steps.push(step("write", `Nemotron 3 Ultra wrote check.py: ${written.fact_name}`, written.approach, { ms: Date.now() - t1, model: "ultra", code }));

  // 2. Tests
  const t2 = Date.now();
  const tests = await chatJSON(
    "nano",
    {
      name: "forge_tests",
      purpose: `forge tests ${rule.key}`,
      schema: TestSchema,
      maxTokens: 1500,
      temperature: 0.1,
      system: [
        "You write plain Python tests (no pytest) for a module `check` that exposes check(sources) -> dict with keys found, value, quote, source_url, fact.",
        "Write a module with 2 to 4 functions whose names start with test_ (for example test_found, test_quote_in_source). Only functions named test_* run. Load the real inputs with `sources = json.load(open('/work/sources.json'))` and import the module with `from check import check`.",
        "Assert on what the verified facts say: found is True when a verified quote exists, the returned quote is a substring of one source's text, source_url is one of the source urls, and value matches the verified fact when one was given (compare loosely: digits, percent signs, and case-insensitive words).",
        "Add one negative test: calling check with a source whose text is unrelated returns found False and does not raise.",
        "Return JSON only: tests_code is the full module text, cases lists one sentence per test.",
      ].join(" "),
      user: `CHECK MODULE:\n${code}\n\nEXPECTED on the real sources: value=${JSON.stringify(written.expected_value)} quote=${JSON.stringify(written.expected_quote)}\n\nVERIFIED FACTS:\n${backed.length ? backed.map((c) => `- ${c.claim} | quote: "${c.quote.slice(0, 160)}" | url: ${c.matched_url ?? c.source_url}`).join("\n") : "(none)"}\n\nSOURCE URLS:\n${sources.map((s) => s.url).join("\n")}`,
    },
    meter,
  );
  // Nano sometimes writes module-level asserts under comment headers instead of
  // functions; the harness only runs functions. Ask once more with that feedback,
  // then wrap whatever came back so at least one test runs.
  let testFunctions = countTestFunctions(tests.tests_code);
  if (testFunctions === 0) {
    const retry = await chatJSON(
      "nano",
      {
        name: "forge_tests",
        purpose: `forge tests retry ${rule.key}`,
        schema: TestSchema,
        maxTokens: 1500,
        temperature: 0.1,
        system: "You fix a Python test module. The harness runs only functions whose names start with test_. Return JSON only: tests_code is the full rewritten module, cases lists one sentence per test function.",
        user: `This module defines ${testFunctions} functions named test_*. Rewrite it so every check lives inside a function named test_* (2 to 4 functions), keeping the imports, the sources load, and every assertion. Module:\n\n${tests.tests_code}`,
      },
      meter,
    );
    if (countTestFunctions(retry.tests_code) > 0) {
      tests.tests_code = retry.tests_code;
      tests.cases = retry.cases;
    } else {
      tests.tests_code = wrapAsTest(tests.tests_code);
      tests.cases = ["test_module: every assertion in the module, run as one test"];
    }
    testFunctions = countTestFunctions(tests.tests_code);
  }
  steps.push(step("tests", `Nemotron 3 Nano wrote ${testFunctions} test${testFunctions === 1 ? "" : "s"}`, tests.cases.map((c) => `- ${c}`).join("\n"), { ms: Date.now() - t2, model: "nano", code: tests.tests_code }));

  // 3. Run and iterate
  let status: ForgeRow["status"] = "failed";
  let lastOutput: Record<string, unknown> | null = null;
  let iterations = 0;
  let sandboxNote: string | null = null;
  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;
    const t3 = Date.now();
    const run = await runInSandbox({
      files: { "check.py": code, "test_check.py": tests.tests_code, "sources.json": JSON.stringify(sources), "run_tests.py": HARNESS },
      command: "python3 /work/run_tests.py",
      timeoutSeconds: 60,
      network: false,
    });
    let parsed: Record<string, unknown> | null = null;
    const lastLine = run.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      parsed = null;
    }
    lastOutput = parsed;
    if (run.error && !sandboxConfigured()) {
      sandboxNote = run.error;
      steps.push(step("run", "Sandbox not available", run.error, { ms: run.ms, ok: false }));
      status = "unrun";
      break;
    }
    const passed = Number(parsed?.passed ?? 0);
    const failed = Number(parsed?.failed ?? 0);
    const detail = run.error
      ? run.error
      : parsed
        ? `${passed} passed, ${failed} failed on ${sandboxImage()} (exit ${run.exit_code})\n${(parsed.results as Array<{ name: string; ok: boolean; error?: string }> | undefined)?.map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.name}${r.error ? `: ${r.error}` : ""}`).join("\n") ?? ""}`
        : `exit ${run.exit_code}\n${(run.stderr || run.stdout).slice(-1200)}`;
    steps.push(step("run", `Sandbox run ${i + 1}: ${run.ok ? "all tests passed" : "tests failed"}`, detail, { ms: run.ms, ok: run.ok, operation_id: run.operation_id ?? undefined, output: parsed?.output as Record<string, unknown> | undefined }));
    if (run.ok) {
      status = "passed";
      break;
    }
    if (i === maxIterations - 1) break;

    // Revise with the failure in hand.
    const t4 = Date.now();
    const revised = await chatJSON(
      "ultra",
      {
        name: "forge_revise",
        purpose: `forge revise ${rule.key}`,
        schema: ReviseSchema,
        maxTokens: 2200,
        temperature: 0.1,
        system: [
          "You fix a small Python module so its tests pass. Keep the same function signature check(sources) -> dict and the same contract (found, value, quote, source_url, fact).",
          "Use only re, json, datetime, math. quote must be an exact substring of a source text. Do not weaken the tests; fix the check. Return JSON only with diagnosis (one sentence) and the full corrected module in code.",
        ].join(" "),
        user: `CURRENT check.py:\n${code}\n\nTESTS (test_check.py):\n${tests.tests_code}\n\nSANDBOX RESULT:\n${detail.slice(0, 2500)}\n\nFIRST SOURCE EXCERPT:\n${sources[0]?.text.slice(0, 1500) ?? ""}`,
      },
      meter,
    );
    code = revised.code;
    steps.push(step("revise", `Nemotron 3 Ultra revised check.py (iteration ${i + 1})`, revised.diagnosis, { ms: Date.now() - t4, model: "ultra", code }));
    void t3;
  }

  const llmCost = meter.llm.reduce((s, c) => s + c.cost_usd, 0);
  const forge: ForgeRow = {
    id: newId(),
    account_id: account.id,
    product_id: product.id,
    rule_id: rule.id,
    rule_title: rule.title,
    fact_name: written.fact_name,
    status,
    iterations,
    code,
    tests: tests.tests_code,
    sources: sources.map((s) => ({ url: s.url, title: s.title })),
    last_output: lastOutput,
    steps,
    sandbox_image: sandboxImage(),
    sandbox_note: sandboxNote,
    llm_cost_usd: llmCost,
    tavily_calls: meter.tavily_calls,
    duration_ms: Date.now() - meter.started_at,
    created_at: new Date().toISOString(),
  };
  await insertForge(forge);
  try {
    await insertRun({
      account_id: account.id,
      product_id: product.id,
      kind: "forge",
      tavily_calls: meter.tavily_calls,
      tavily_credits: meter.tavily_credits,
      llm: meter.llm,
      llm_cost_usd: llmCost,
      all_ultra_cost_usd: meter.llm.reduce((s, c) => s + (c.prompt_tokens * PRICES_PER_M.ultra.in + c.completion_tokens * PRICES_PER_M.ultra.out) / 1_000_000, 0),
      duration_ms: Date.now() - meter.started_at,
    });
  } catch (err) {
    console.error("[shop-rules] forge run record failed", err);
  }
  return forge;
}
