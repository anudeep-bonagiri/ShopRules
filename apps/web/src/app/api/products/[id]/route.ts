import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { deleteProduct, getProduct, listAlerts, listPrices, listRules, listSkills, updateProductOverrides } from "@/lib/db";
import { sanitizeOverrides } from "@/lib/product";

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

// Seller-set fields: price_override, unit_cost, dutiable_share, units_per_week,
// origin_country, hts_heading (catalog), hts_detail, for_children, materials.
// Send null to clear a field and fall back to the workspace default.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const product = await getProduct(account.id, params.id);
    if (!product) throw new ApiError(404, "Product not found");
    const body = await readJson<unknown>(req);
    const { patch, errors } = sanitizeOverrides(body);
    if (errors.length) throw new ApiError(400, errors.join("; "));
    if (Object.keys(patch).length === 0) throw new ApiError(400, "Nothing to update");
    const updated = await updateProductOverrides(account.id, product.id, patch);
    return json({ product: updated });
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
