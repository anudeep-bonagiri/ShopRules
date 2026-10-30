import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { getProduct, listRules } from "@/lib/db";
import { forgeCheck } from "@/lib/forge";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Rule Forge: write a check as code, run it in a Token Factory sandbox, test it.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const product = await getProduct(account.id, params.id);
    if (!product) throw new ApiError(404, "Product not found");
    const body = await readJson<{ rule_id?: string; max_iterations?: number }>(req);
    const rules = await listRules(product.id, account.id);
    const rule = body.rule_id ? rules.find((r) => r.id === body.rule_id) : rules.find((r) => r.family === "tariff") ?? rules[0];
    if (!rule) throw new ApiError(400, "Pick a watch rule to forge a check for");
    const forge = await forgeCheck(account, product, rule, { maxIterations: typeof body.max_iterations === "number" ? Math.min(Math.max(body.max_iterations, 1), 4) : 3 });
    return json({ forge }, { status: 201 });
  } catch (err) {
    return fail(err);
  }
}
