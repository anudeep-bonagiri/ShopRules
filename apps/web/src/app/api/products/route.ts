import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { listProducts } from "@/lib/db";
import { ingestProduct, type PageFields } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const account = await currentAccount();
    return json({ products: await listProducts(account.id) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const account = await currentAccount();
    const body = await readJson<{ url?: string; page?: PageFields & { materials?: string[] | string } }>(req);
    if (!body.url) throw new ApiError(400, "url is required");
    const products = await listProducts(account.id);
    if (products.length >= 25) throw new ApiError(429, "This workspace watches 25 products already. Remove one first.");
    const page = body.page && typeof body.page === "object" ? sanitizePage(body.page) : undefined;
    const result = await ingestProduct(account, body.url, page);
    return json({ product: result.product, rules: result.rules, meter: result.meter, existing: result.existing }, { status: result.existing ? 200 : 201 });
  } catch (err) {
    return fail(err);
  }
}

// Older extension builds send materials as one string; newer ones send a list.
function materialsList(raw: unknown): string[] | undefined {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;|/]/) : [];
  const list = parts
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 10);
  return list.length ? list : undefined;
}

function sanitizePage(p: PageFields): PageFields {
  return {
    title: typeof p.title === "string" ? p.title.slice(0, 300) : undefined,
    price: typeof p.price === "number" && Number.isFinite(p.price) ? p.price : null,
    currency: typeof p.currency === "string" ? p.currency.slice(0, 3).toUpperCase() : null,
    description: typeof p.description === "string" ? p.description.slice(0, 6000) : undefined,
    materials: materialsList(p.materials),
    image: typeof p.image === "string" && /^https?:\/\//.test(p.image) ? p.image.slice(0, 500) : null,
    marketplace: typeof p.marketplace === "string" ? p.marketplace.slice(0, 20).toLowerCase() : null,
  };
}
