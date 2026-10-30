import { currentAccount, fail, json } from "@/lib/account";
import { listAlerts } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const account = await currentAccount();
    const status = (new URL(req.url).searchParams.get("status") ?? "new") as "new" | "dismissed" | "actioned" | "all";
    const valid = ["new", "dismissed", "actioned", "all"].includes(status) ? status : "new";
    return json({ alerts: await listAlerts(account.id, valid) });
  } catch (err) {
    return fail(err);
  }
}
