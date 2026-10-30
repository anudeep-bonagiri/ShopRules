import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { deleteProduct, getProduct, listAlerts, listPrices, listRules, listSkills, setProductDutyRate, updateProductOverrides } from "@/lib/db";
import { sanitizeOverrides } from "@/lib/product";
import { fetchHtsRate } from "@/lib/hts-rate";
import { newMeter } from "@/lib/schemas";
import { reseedProductRules } from "@/lib/pipeline";

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
    // A new heading means a new official duty rate; read it from hts.usitc.gov (Tavily Extract, no model).
    if ("hts_heading" in patch || "hts_detail" in patch) {
      const heading = updated.overrides?.hts_heading ?? updated.profile.hts_candidates[0]?.code ?? null;
      if (heading) {
        try {
          const rate = await fetchHtsRate(heading, newMeter(), { detail: updated.overrides?.hts_detail ?? updated.profile.hts_detail ?? null });
          await setProductDutyRate(account.id, product.id, rate);
          updated.duty_rate = rate;
        } catch (err) {
          console.error("[shop-rules] duty rate refresh failed", err instanceof Error ? err.message : err);
        }
      }
    }
    // Origin, heading, materials, and the for-children flag decide which rules apply.
    const reseedKeys = ["origin_country", "hts_heading", "for_children", "materials"];
    let reseed: { added: number; removed: number; kept: number } | null = null;
    if (Object.keys(patch).some((k) => reseedKeys.includes(k))) {
      const r = await reseedProductRules(account, updated);
      reseed = { added: r.added, removed: r.removed, kept: r.kept };
    }
    return json({ product: updated, reseed });
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
