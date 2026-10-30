import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { listRulesForAccount, updateRule } from "@/lib/db";

export const dynamic = "force-dynamic";

const CADENCES = new Set([24, 72, 168]);

// Pause or resume a rule, or change how often it runs (24, 72, or 168 hours).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const rule = (await listRulesForAccount(account.id)).find((r) => r.id === params.id);
    if (!rule) throw new ApiError(404, "Rule not found");
    const body = await readJson<{ paused?: unknown; cadence_hours?: unknown }>(req);
    const patch: { paused?: boolean; cadence_hours?: number } = {};
    if (body.paused !== undefined) {
      if (typeof body.paused !== "boolean") throw new ApiError(400, "paused must be true or false");
      patch.paused = body.paused;
    }
    if (body.cadence_hours !== undefined) {
      const n = Number(body.cadence_hours);
      if (!CADENCES.has(n)) throw new ApiError(400, "cadence_hours must be 24, 72, or 168");
      patch.cadence_hours = n;
    }
    if (Object.keys(patch).length === 0) throw new ApiError(400, "Nothing to update");
    const updated = await updateRule(rule.id, patch, account.id);
    return json({ rule: updated });
  } catch (err) {
    return fail(err);
  }
}
