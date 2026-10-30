import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { insertRun, saveNexusVerification } from "@/lib/db";
import { nexusSeed } from "@/lib/nexus";
import { verifyStateThreshold, type NexusVerification } from "@/lib/nexus-crawl";
import { newMeter } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Verifies nexus thresholds against the state revenue sites: Tavily Map finds
// the remote-seller pages, Extract reads them, a parser pulls the dollar and
// transaction tests with the exact quote. No model is involved. Body:
// { states?: string[] } (defaults to the workspace's ship-to states, max 8).
export async function POST(req: Request) {
  try {
    const account = await currentAccount();
    const body = await readJson<{ states?: unknown }>(req);
    const requested = Array.isArray(body.states) ? body.states.filter((s): s is string => typeof s === "string") : (account.settings.ship_to_states ?? []);
    const states = Array.from(new Set(requested.map((s) => s.toUpperCase()))).slice(0, 8);
    if (states.length === 0) throw new ApiError(400, "No states to verify. Pick ship-to states in Settings first.");
    const meter = newMeter();
    const results: NexusVerification[] = [];
    const errors: string[] = [];
    for (const code of states) {
      const seed = nexusSeed(code);
      if (!seed) {
        errors.push(`${code}: no economic nexus seed for this jurisdiction`);
        continue;
      }
      try {
        const v = await verifyStateThreshold(seed, meter);
        await saveNexusVerification(account.id, v);
        results.push(v);
      } catch (err) {
        errors.push(`${code}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await insertRun({
      account_id: account.id,
      product_id: null,
      kind: "nexus_verify",
      tavily_calls: meter.tavily_calls,
      tavily_credits: meter.tavily_credits,
      llm: [],
      llm_cost_usd: 0,
      all_ultra_cost_usd: 0,
      duration_ms: Date.now() - meter.started_at,
    }).catch(() => undefined);
    return json({ verifications: results, errors, meter });
  } catch (err) {
    return fail(err);
  }
}
