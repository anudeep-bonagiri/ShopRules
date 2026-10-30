import { ApiError, currentAccount, fail, json } from "@/lib/account";
import { deleteForge, getForge } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const forge = await getForge(account.id, params.id);
    if (!forge) throw new ApiError(404, "Forge not found");
    return json({ forge });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    await deleteForge(account.id, params.id);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
