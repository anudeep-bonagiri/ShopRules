import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { getProduct, listPrices } from "@/lib/db";
import { observePrice } from "@/lib/prices";

export const dynamic = "force-dynamic";

// The extension posts the price it sees on a watched listing. A point is kept
// only when it is new information (moved by a cent, plausible), and a move past
// the seller's threshold raises a price_change alert.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const product = await getProduct(account.id, params.id);
    if (!product) throw new ApiError(404, "Product not found");
    const body = await readJson<{ price?: unknown; currency?: unknown; observed_at?: unknown; source?: unknown; confidence?: unknown }>(req);
    const price = typeof body.price === "string" ? Number(body.price) : body.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price > 1_000_000) throw new ApiError(400, "price must be a positive number");
    const currency = typeof body.currency === "string" && /^[A-Za-z]{3}$/.test(body.currency) ? body.currency.toUpperCase() : null;
    const source = body.source === "extension" || body.source === "check" ? body.source : "extension";
    const confidence = typeof body.confidence === "number" && Number.isFinite(body.confidence) ? Math.min(Math.max(body.confidence, 0), 1) : undefined;
    const result = await observePrice(account, product, { price: Math.round(price * 100) / 100, currency, source, confidence });
    return json({ ...result, price_history: await listPrices(product.id, account.id) }, { status: result.inserted ? 201 : 200 });
  } catch (err) {
    return fail(err);
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const product = await getProduct(account.id, params.id);
    if (!product) throw new ApiError(404, "Product not found");
    return json({ price_history: await listPrices(product.id, account.id) });
  } catch (err) {
    return fail(err);
  }
}
