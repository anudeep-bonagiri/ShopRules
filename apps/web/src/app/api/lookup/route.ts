import { currentAccount, fail, json } from "@/lib/account";
import { findProductByUrl, listRules } from "@/lib/db";
import { normalizeListingUrl } from "@/lib/pipeline";
import { marketplaceFromUrl } from "@/lib/rules-catalog";

export const dynamic = "force-dynamic";

// Cheap lookup for the extension's hover state. No Tavily or Nemotron calls.
export async function GET(req: Request) {
  try {
    const account = await currentAccount();
    const raw = new URL(req.url).searchParams.get("url") ?? "";
    const url = normalizeListingUrl(raw);
    const marketplace = marketplaceFromUrl(url);
    const product = await findProductByUrl(account.id, url);
    const rules = product ? await listRules(product.id, account.id) : [];
    const families = product
      ? Array.from(new Set(rules.map((r) => r.family)))
      : ["tariff", "safety", marketplace === "shopify" ? "tax" : "tax", "policy"];
    return json({ watched: Boolean(product), product, rules, marketplace, families_preview: families });
  } catch (err) {
    return fail(err);
  }
}
