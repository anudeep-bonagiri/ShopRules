// Standing instructions from dismissals. Pure, no I/O, unit-tested.
import type { SkillRow } from "./db";

function plainText(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Four words and twenty characters: anything shorter ("tax") is a label, not an instruction. */
export function usableSkillText(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return t.length >= 20 && t.split(/\s+/).filter(Boolean).length >= 4;
}

/**
 * The seller's own sentence is the instruction; the model's rewrite rides along
 * only when it is long enough to carry meaning. Pure, unit-tested.
 */
export function skillRowFromDismissal(accountId: string, productId: string, reason: string, model: { skill: string; scope: "product" | "family" | "account" } | null): Omit<SkillRow, "id" | "created_at"> {
  const text = plainText(reason).slice(0, 400);
  const rewrite = model && usableSkillText(model.skill) ? plainText(model.skill).slice(0, 400) : null;
  const scope = model?.scope ?? "product";
  return { account_id: accountId, product_id: scope === "product" ? productId : null, scope, text, rewrite };
}
