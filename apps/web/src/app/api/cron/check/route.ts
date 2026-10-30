import { fail, json } from "@/lib/account";
import { getOrCreateAccount, listAccountIds, listProducts } from "@/lib/db";
import { runChecks } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron hits this with GET and a bearer token; a script can POST it too.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const summary = { accounts: 0, products: 0, checked: 0, alerts: 0, errors: 0 };
  try {
    for (const id of await listAccountIds()) {
      summary.accounts += 1;
      const account = await getOrCreateAccount(id);
      for (const product of await listProducts(account.id)) {
        if (Date.now() - started > 240_000) return json({ ...summary, partial: true });
        summary.products += 1;
        try {
          const r = await runChecks(account, product, { maxRules: 3 });
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
