import { currentAccount, fail, json } from "@/lib/account";
import { listAlerts, listRuns } from "@/lib/db";
import { buildTavilyReceipt } from "@/lib/tavily-receipt";
import { MODELS, PRICES_PER_M } from "@/lib/nemotron";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const account = await currentAccount();
    const [runs, alerts] = await Promise.all([listRuns(account.id), listAlerts(account.id, "all")]);
    const tavily = buildTavilyReceipt(runs, alerts.map((a) => ({ family: a.family, trail: a.trail ?? null })));
    const totals = { tavily_calls: 0, tavily_credits: 0, llm_cost_usd: 0, all_ultra_cost_usd: 0, saved_usd: 0, saved_pct: 0, calls: 0, prompt_tokens: 0, completion_tokens: 0 };
    const byTier: Record<string, { calls: number; prompt_tokens: number; completion_tokens: number; cost_usd: number; ms: number }> = {};
    for (const run of runs) {
      totals.tavily_calls += run.tavily_calls;
      totals.tavily_credits += run.tavily_credits;
      totals.llm_cost_usd += run.llm_cost_usd;
      totals.all_ultra_cost_usd += run.all_ultra_cost_usd;
      for (const c of run.llm) {
        totals.calls += 1;
        totals.prompt_tokens += c.prompt_tokens;
        totals.completion_tokens += c.completion_tokens;
        const t = (byTier[c.tier] ??= { calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, ms: 0 });
        t.calls += 1;
        t.prompt_tokens += c.prompt_tokens;
        t.completion_tokens += c.completion_tokens;
        t.cost_usd += c.cost_usd;
        t.ms += c.ms;
      }
    }
    totals.saved_usd = Math.max(totals.all_ultra_cost_usd - totals.llm_cost_usd, 0);
    totals.saved_pct = totals.all_ultra_cost_usd > 0 ? (totals.saved_usd / totals.all_ultra_cost_usd) * 100 : 0;
    return json({ runs: runs.slice(0, 100), totals, by_tier: byTier, models: MODELS, prices_per_million: PRICES_PER_M, tavily });
  } catch (err) {
    return fail(err);
  }
}
