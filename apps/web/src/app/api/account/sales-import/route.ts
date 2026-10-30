import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { updateAccount } from "@/lib/db";
import { aggregateOrders } from "@/lib/csv";

export const dynamic = "force-dynamic";

// Takes a Shopify Orders or Etsy Orders CSV export (as text), aggregates
// dollars and order counts per ship-to state for the current and previous
// calendar year, and stores only those aggregates. No order rows are kept.
export async function POST(req: Request) {
  try {
    const account = await currentAccount();
    const body = await readJson<{ csv?: unknown }>(req);
    if (typeof body.csv !== "string" || !body.csv.trim()) throw new ApiError(400, "csv is required");
    if (body.csv.length > 15_000_000) throw new ApiError(413, "That file is over 15 MB. Export a shorter date range.");
    let agg;
    try {
      agg = aggregateOrders(body.csv);
    } catch (err) {
      throw new ApiError(422, err instanceof Error ? err.message : String(err));
    }
    const year = String(new Date().getUTCFullYear());
    const state_sales: Record<string, number> = { ...(account.settings.state_sales ?? {}) };
    for (const [st, v] of Object.entries(agg.by_year[year] ?? {})) state_sales[st] = Math.round(v.dollars);
    const updated = await updateAccount(account.id, {
      settings: {
        ...account.settings,
        state_sales,
        state_sales_by_year: agg.by_year,
        sales_import: { source: agg.source, imported_at: new Date().toISOString(), orders_seen: agg.orders_seen, years: agg.years },
      },
    });
    return json({ account: updated, summary: { source: agg.source, orders_seen: agg.orders_seen, orders_skipped: agg.orders_skipped, years: agg.years, states: agg.states } });
  } catch (err) {
    return fail(err);
  }
}
