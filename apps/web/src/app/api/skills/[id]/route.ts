import { ApiError, currentAccount, fail, json, readJson } from "@/lib/account";
import { deleteSkill, listSkills, updateSkill } from "@/lib/db";

export const dynamic = "force-dynamic";

// Standing instructions written from dismissals: edit the text or delete one.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const skill = (await listSkills(account.id)).find((s) => s.id === params.id);
    if (!skill) throw new ApiError(404, "Instruction not found");
    const body = await readJson<{ text?: unknown; scope?: unknown }>(req);
    const patch: { text?: string; scope?: string } = {};
    if (body.text !== undefined) {
      if (typeof body.text !== "string" || body.text.trim().length < 6 || body.text.length > 400) throw new ApiError(400, "text must be 6 to 400 characters");
      patch.text = body.text.trim();
    }
    if (body.scope !== undefined) {
      if (body.scope !== "product" && body.scope !== "family" && body.scope !== "account") throw new ApiError(400, "scope must be product, family, or account");
      patch.scope = body.scope;
    }
    if (Object.keys(patch).length === 0) throw new ApiError(400, "Nothing to update");
    const updated = await updateSkill(account.id, skill.id, patch);
    return json({ skill: updated });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const account = await currentAccount();
    const skill = (await listSkills(account.id)).find((s) => s.id === params.id);
    if (!skill) throw new ApiError(404, "Instruction not found");
    await deleteSkill(account.id, skill.id);
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
