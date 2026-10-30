import { currentAccount, fail, json } from "@/lib/account";
import { listProducts, listRulesForAccount } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const account = await currentAccount();
    const [rules, products] = await Promise.all([listRulesForAccount(account.id), listProducts(account.id)]);
    const titles = new Map(products.map((p) => [p.id, p.title]));
    return json({ rules: rules.map((r) => ({ ...r, product_title: titles.get(r.product_id) ?? "" })) });
  } catch (err) {
    return fail(err);
  }
}
