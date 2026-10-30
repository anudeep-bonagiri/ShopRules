import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { getAlert, getProduct, listAlerts, listRules, listRulesForAccount, updateAlert } from "@/lib/db";
import { similarAlerts } from "@/lib/similar-alerts";
import { skillFromDismissal } from "@/lib/pipeline";
import { observePrice } from "@/lib/prices";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const alert = await getAlert(account.id, params.id);
    if (!alert) throw new ApiError(404, "Alert not found");
    const product = await getProduct(account.id, alert.product_id);
    const rules = product ? await listRules(product.id, account.id) : [];
    const rule = rules.find((r) => r.id === alert.rule_id) ?? null;
    return json({ alert, product, rule, sources: alert.sources });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const alert = await getAlert(account.id, params.id);
    if (!alert) throw new ApiError(404, "Alert not found");
    const body = await readJson<{ status?: string; reason?: string; also_dismiss?: unknown }>(req);
    const status = body.status;
    if (status !== "dismissed" && status !== "actioned" && status !== "new") throw new ApiError(400, "status must be new, dismissed, or actioned");
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 400) : "";
    // "Also dismiss the similar ones": ids offered by a previous response. The
    // target alert keeps whatever status it already has; no new instruction is written.
    const alsoIds = Array.isArray(body.also_dismiss) ? body.also_dismiss.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
    if (status === "dismissed" && alsoIds.length) {
      const open = await listAlerts(account.id, "new");
      const why = reason || alert.dismiss_reason || null;
      let n = 0;
      for (const a of open) {
        if (!alsoIds.includes(a.id)) continue;
        await updateAlert(a.id, { status: "dismissed", dismiss_reason: why }, account.id);
        n += 1;
      }
      const current = alert.status === "new" ? await updateAlert(alert.id, { status, dismiss_reason: why }, account.id) : alert;
      return json({ alert: current, skill: null, similar: [], also_dismissed: n });
    }
    const updated = await updateAlert(alert.id, { status, dismiss_reason: status === "dismissed" ? reason || null : null }, account.id);
    // Drafting a reprice means the seller is applying it: the product price follows and the history gets a reprice point.
    if (status === "actioned" && alert.status !== "actioned" && alert.pricing?.suggested_price != null) {
      const product = await getProduct(account.id, alert.product_id);
      if (product) {
        await observePrice(account, product, { price: alert.pricing.suggested_price, currency: product.currency, source: "reprice" }).catch((err) => console.error("[shop-rules] reprice point failed", err));
      }
    }
    let skill = null;
    if (status === "dismissed" && reason.length >= 6) {
      const product = await getProduct(account.id, alert.product_id);
      try {
        skill = await skillFromDismissal(account, updated, product, reason);
      } catch (err) {
        console.error("[shop-rules] skill generation failed", err);
      }
    }
    // Siblings the same reason probably covers, for an "also dismiss" offer.
    let similar: ReturnType<typeof similarAlerts> = [];
    if (status === "dismissed") {
      const [open, rules] = await Promise.all([listAlerts(account.id, "new"), listRulesForAccount(account.id)]);
      const scope = skill?.scope === "product" || skill?.scope === "family" || skill?.scope === "account" ? skill.scope : null;
      similar = similarAlerts(updated, open, new Map(rules.map((r) => [r.id, r.key])), scope);
    }
    return json({ alert: updated, skill, similar, also_dismissed: 0 });
  } catch (err) {
    return fail(err);
  }
}
