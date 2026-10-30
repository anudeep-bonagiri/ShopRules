import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { getAlert, getProduct, listRules, updateAlert } from "@/lib/db";
import { skillFromDismissal } from "@/lib/pipeline";

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
    const body = await readJson<{ status?: string; reason?: string }>(req);
    const status = body.status;
    if (status !== "dismissed" && status !== "actioned" && status !== "new") throw new ApiError(400, "status must be new, dismissed, or actioned");
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 400) : "";
    const updated = await updateAlert(alert.id, { status, dismiss_reason: status === "dismissed" ? reason || null : null }, account.id);
    let skill = null;
    if (status === "dismissed" && reason.length >= 6) {
      const product = await getProduct(account.id, alert.product_id);
      try {
        skill = await skillFromDismissal(account, updated, product, reason);
      } catch (err) {
        console.error("[shop-rules] skill generation failed", err);
      }
    }
    return json({ alert: updated, skill });
  } catch (err) {
    return fail(err);
  }
}
