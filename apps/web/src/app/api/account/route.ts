import { currentAccount, fail, json, readJson } from "@/lib/account";
import { updateAccount } from "@/lib/db";

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
      const s = body.settings as { ship_to_states?: unknown; target_margin_pct?: unknown; unit_cost_pct?: unknown; currency?: unknown };
      patch.settings = {
        ...(Array.isArray(s.ship_to_states) ? { ship_to_states: s.ship_to_states.filter((x) => typeof x === "string").slice(0, 20) } : {}),
        ...(typeof s.target_margin_pct === "number" ? { target_margin_pct: Math.min(Math.max(s.target_margin_pct, 0), 95) } : {}),
        ...(typeof s.unit_cost_pct === "number" ? { unit_cost_pct: Math.min(Math.max(s.unit_cost_pct, 1), 99) } : {}),
        ...(typeof s.currency === "string" ? { currency: s.currency.slice(0, 3).toUpperCase() } : {}),
      };
    }
    if (body.telegram_chat_id !== undefined) patch.telegram_chat_id = body.telegram_chat_id ? String(body.telegram_chat_id).slice(0, 64) : null;
    const updated = await updateAccount(account.id, patch);
    return json({ account: { ...updated, telegram_configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && updated.telegram_chat_id) } });
  } catch (err) {
    return fail(err);
  }
}
