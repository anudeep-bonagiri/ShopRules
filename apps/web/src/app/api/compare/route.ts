import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { compareListings } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const account = await currentAccount();
    const body = await readJson<{ title?: string; price?: number | null; marketplace?: string; url?: string }>(req);
    if (!body.title || typeof body.title !== "string") throw new ApiError(400, "title is required");
    const result = await compareListings(account, {
      title: body.title,
      price: typeof body.price === "number" ? body.price : null,
      marketplace: typeof body.marketplace === "string" ? body.marketplace.slice(0, 20) : undefined,
      url: typeof body.url === "string" ? body.url.slice(0, 500) : undefined,
    });
    return json(result);
  } catch (err) {
    return fail(err);
  }
}
