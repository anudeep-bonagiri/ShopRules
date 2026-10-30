import { currentAccount, fail, json } from "@/lib/account";
import { rotateToken } from "@/lib/db";

export const dynamic = "force-dynamic";

// Issues a new workspace token and retires the old one. The extension and any
// "Open on another device" link using the old token stop working.
export async function POST() {
  try {
    const account = await currentAccount();
    const updated = await rotateToken(account.id);
    return json({ account: { ...updated, telegram_configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && updated.telegram_chat_id) } });
  } catch (err) {
    return fail(err);
  }
}
