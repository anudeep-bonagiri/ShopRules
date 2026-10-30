import { currentAccount, fail, json } from "@/lib/account";
import { listForges } from "@/lib/db";
import { sandboxConfigured, sandboxImage } from "@/lib/sandbox";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const account = await currentAccount();
    const productId = new URL(req.url).searchParams.get("product_id") ?? undefined;
    return json({ forges: await listForges(account.id, productId), sandbox: { configured: sandboxConfigured(), image: sandboxImage() } });
  } catch (err) {
    return fail(err);
  }
}
