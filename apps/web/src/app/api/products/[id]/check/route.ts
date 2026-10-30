import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { getProduct } from "@/lib/db";
import { isCheckScope, MAX_RULES_PER_CHECK, runChecks } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Runs the product's rules. scope defaults to "due" (every rule whose cadence
// elapsed). Pass a run_id and poll GET /api/runs/[run_id] every 2 s for live
// progress while this request is still in flight; the final result comes back
// here. force skips the source-hash dedupe and should stay off in normal use.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const product = await getProduct(account.id, params.id);
    if (!product) throw new ApiError(404, "Product not found");
    const body = await readJson<{ scope?: unknown; force?: boolean; max_rules?: number; run_id?: string }>(req);
    if (body.scope !== undefined && !isCheckScope(body.scope)) throw new ApiError(400, "scope must be one of due, all, tariff, safety, tax, policy");
    const result = await runChecks(account, product, {
      scope: isCheckScope(body.scope) ? body.scope : "due",
      force: Boolean(body.force),
      maxRules: typeof body.max_rules === "number" ? Math.min(Math.max(body.max_rules, 1), MAX_RULES_PER_CHECK) : MAX_RULES_PER_CHECK,
      runId: typeof body.run_id === "string" ? body.run_id : undefined,
    });
    return json(result);
  } catch (err) {
    return fail(err);
  }
}
