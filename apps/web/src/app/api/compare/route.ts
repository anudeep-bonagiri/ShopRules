import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { consumeQuota, findProductByUrl, getProduct, setCompareCache } from "@/lib/db";
import { compareListings, normalizeListingUrl } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_MS = 24 * 3600 * 1000;

// Competitor prices are a paid search plus a model call, so the result is kept
// on the product for 24 hours. Pass product_id or the listing url to use the
// cache; force: true refreshes it.
export async function POST(req: Request) {
  try {
    const account = await currentAccount();
    const body = await readJson<{ title?: string; price?: number | null; marketplace?: string; url?: string; product_id?: string; force?: boolean }>(req);
    if (!body.title || typeof body.title !== "string") throw new ApiError(400, "title is required");
    let product = typeof body.product_id === "string" ? await getProduct(account.id, body.product_id) : null;
    if (!product && typeof body.url === "string") {
      try {
        product = await findProductByUrl(account.id, normalizeListingUrl(body.url));
      } catch {
        product = null;
      }
    }
    const cached = product?.compare_cache;
    if (cached && !body.force && Date.now() - Date.parse(cached.at) < CACHE_MS) {
      return json({ ...cached.result, cached: true, cached_at: cached.at, meter: null });
    }
    // Cache hits above are free; a live search counts against the daily cap.
    const quota = await consumeQuota(account.id, "compares");
    if (!quota.allowed) throw new ApiError(429, quota.message ?? "Daily limit reached");
    const result = await compareListings(account, {
      title: body.title,
      price: typeof body.price === "number" ? body.price : null,
      marketplace: typeof body.marketplace === "string" ? body.marketplace.slice(0, 20) : undefined,
      url: typeof body.url === "string" ? body.url.slice(0, 500) : undefined,
    });
    if (product) {
      const { meter: _meter, ...rest } = result;
      void _meter;
      await setCompareCache(account.id, product.id, rest).catch((err) => console.error("[shop-rules] compare cache write failed", err));
    }
    return json({ ...result, cached: false, cached_at: new Date().toISOString() });
  } catch (err) {
    return fail(err);
  }
}
