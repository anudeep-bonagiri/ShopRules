import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { getProduct } from "@/lib/db";
import { runChecks } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const product = await getProduct(account.id, params.id);
    if (!product) throw new ApiError(404, "Product not found");
    const body = await readJson<{ force?: boolean; max_rules?: number }>(req);
    const result = await runChecks(account, product, {
      force: Boolean(body.force),
      maxRules: typeof body.max_rules === "number" ? Math.min(Math.max(body.max_rules, 1), 8) : 4,
    });
    return json(result);
  } catch (err) {
    return fail(err);
  }
}
