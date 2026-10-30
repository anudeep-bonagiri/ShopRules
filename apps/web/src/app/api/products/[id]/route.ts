import { ApiError, currentAccount, fail, json } from "@/lib/account";
import { deleteProduct, getProduct, listAlerts, listPrices, listRules, listSkills } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const product = await getProduct(account.id, params.id);
    if (!product) throw new ApiError(404, "Product not found");
    const [rules, alerts, price_history, skills] = await Promise.all([
      listRules(product.id, account.id),
      listAlerts(account.id, "all", product.id),
      listPrices(product.id, account.id),
      listSkills(account.id, product.id),
    ]);
    return json({ product, rules, alerts, price_history, skills });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const product = await getProduct(account.id, params.id);
    if (!product) throw new ApiError(404, "Product not found");
    await deleteProduct(account.id, product.id);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
