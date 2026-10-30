import { currentAccount, fail, json, readJson } from "@/lib/account";
import { deleteAccount, listProducts, updateAccount } from "@/lib/db";
import { reseedProductRules } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const account = await currentAccount();
    return json({ account: { ...account, telegram_configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && account.telegram_chat_id) } });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const account = await currentAccount();
    const body = await readJson<{ settings?: Record<string, unknown>; telegram_chat_id?: string | null }>(req);
    const patch: { settings?: Record<string, unknown>; telegram_chat_id?: string | null } = {};
    if (body.settings && typeof body.settings === "object") {
      const s = body.settings as { ship_to_states?: unknown; target_margin_pct?: unknown; unit_cost_pct?: unknown; currency?: unknown; units_per_week?: unknown; state_sales?: unknown; dutiable_share?: unknown; rounding?: unknown; price_change_pct?: unknown };
      patch.settings = {
        ...(Array.isArray(s.ship_to_states) ? { ship_to_states: s.ship_to_states.filter((x) => typeof x === "string").slice(0, 20) } : {}),
        ...(typeof s.target_margin_pct === "number" ? { target_margin_pct: Math.min(Math.max(s.target_margin_pct, 0), 95) } : {}),
        ...(typeof s.unit_cost_pct === "number" ? { unit_cost_pct: Math.min(Math.max(s.unit_cost_pct, 1), 99) } : {}),
        ...(typeof s.currency === "string" ? { currency: s.currency.slice(0, 3).toUpperCase() } : {}),
        ...(typeof s.units_per_week === "number" ? { units_per_week: Math.min(Math.max(Math.round(s.units_per_week), 0), 100000) } : {}),
        ...(typeof s.dutiable_share === "number" && Number.isFinite(s.dutiable_share) ? { dutiable_share: Math.min(Math.max(s.dutiable_share, 0), 1) } : {}),
        ...(s.rounding === 0.5 || s.rounding === 0.99 || s.rounding === 0.01 ? { rounding: s.rounding } : {}),
        ...(typeof s.price_change_pct === "number" && Number.isFinite(s.price_change_pct) ? { price_change_pct: Math.min(Math.max(s.price_change_pct, 0.5), 50) } : {}),
        ...(s.state_sales && typeof s.state_sales === "object"
          ? {
              state_sales: Object.fromEntries(
                Object.entries(s.state_sales as Record<string, unknown>)
                  .filter(([k, v]) => /^[A-Z]{2}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 0)
                  .map(([k, v]) => [k, Math.round(v as number)]),
              ),
            }
          : {}),
      };
    }
    if (body.telegram_chat_id !== undefined) patch.telegram_chat_id = body.telegram_chat_id ? String(body.telegram_chat_id).slice(0, 64) : null;
    const updated = await updateAccount(account.id, patch);
    // New ship-to states mean new tax rules for every product; dropped states remove theirs.
    const before = [...(account.settings.ship_to_states ?? [])].sort().join(",");
    const after = [...(updated.settings.ship_to_states ?? [])].sort().join(",");
    let reseeded = 0;
    if (patch.settings?.ship_to_states && before !== after) {
      for (const product of await listProducts(updated.id)) {
        try {
          const r = await reseedProductRules(updated, product);
          reseeded += r.added + r.removed;
        } catch (err) {
          console.error("[shop-rules] reseed failed", product.id, err);
        }
      }
    }
    return json({ account: { ...updated, telegram_configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && updated.telegram_chat_id) }, reseeded });
  } catch (err) {
    return fail(err);
  }
}

// Removes the workspace and everything in it. The extension token stops working
// and the cookie is cleared; the next visit starts a fresh workspace.
export async function DELETE() {
  try {
    const account = await currentAccount();
    await deleteAccount(account.id);
    const res = json({ deleted: account.id });
    res.headers.append("set-cookie", "sr_account=; Path=/; Max-Age=0; SameSite=Lax");
    return res;
  } catch (err) {
    return fail(err);
  }
}
