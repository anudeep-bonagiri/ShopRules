import { fail, json } from "@/lib/account";
import { getOrCreateAccount, listAccountIds, listProducts } from "@/lib/db";
import { runChecks } from "@/lib/pipeline";
import { refreshPrices } from "@/lib/prices";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron hits this with GET and a bearer token; a script can POST it too.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const summary = { accounts: 0, products: 0, checked: 0, alerts: 0, errors: 0, prices: { fetched: 0, recorded: 0, alerts: 0, errors: 0 } };
  try {
    const ids = await listAccountIds();
    // Price refresh first: no model calls, so it always fits the budget.
    for (const id of ids) {
      if (Date.now() - started > 90_000) break;
      try {
        const r = await refreshPrices(await getOrCreateAccount(id), { budgetMs: 90_000, started });
        summary.prices.fetched += r.fetched;
        summary.prices.recorded += r.recorded;
        summary.prices.alerts += r.alerts;
        summary.prices.errors += r.errors;
      } catch (err) {
        summary.prices.errors += 1;
        console.error("[shop-rules] cron price refresh failed", id, err);
      }
    }
    for (const id of ids) {
      summary.accounts += 1;
      const account = await getOrCreateAccount(id);
      for (const product of await listProducts(account.id)) {
        if (Date.now() - started > 240_000) return json({ ...summary, partial: true });
        summary.products += 1;
        try {
          const r = await runChecks(account, product, { scope: "due", maxRules: 3 });
          summary.checked += r.checked;
          summary.alerts += r.alerts.length;
          summary.errors += r.errors.length;
        } catch (err) {
          summary.errors += 1;
          console.error("[shop-rules] cron product failed", product.id, err);
        }
      }
    }
    return json(summary);
  } catch (err) {
    return fail(err);
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
