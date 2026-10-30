import { ApiError, currentAccount, fail, json } from "@/lib/account";
import { getCheckRun } from "@/lib/db";

export const dynamic = "force-dynamic";

// Live progress of one check run. 404 until the run has written its first record.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const run = await getCheckRun(account.id, params.id);
    if (!run) throw new ApiError(404, "Run not found yet");
    return json({ run });
  } catch (err) {
    return fail(err);
  }
}
