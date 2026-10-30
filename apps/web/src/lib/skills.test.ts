import { test } from "node:test";
import assert from "node:assert/strict";
import { skillRowFromDismissal, usableSkillText } from "./skills.ts";

test("a one-word model rewrite is not an instruction", () => {
  assert.equal(usableSkillText("tax"), false);
  assert.equal(usableSkillText("Ignore sales tax"), false);
  assert.equal(usableSkillText("Etsy collects sales tax for this shop in every state"), true);
});

test("the seller's own sentence is the stored instruction; the rewrite rides along only when usable", () => {
  const reason = "Etsy collects and remits sales tax for us as a marketplace facilitator, so nexus thresholds do not apply to this shop.";
  const short = skillRowFromDismissal("acc", "prod", reason, { skill: "tax", scope: "account" });
  assert.equal(short.text, reason);
  assert.equal(short.rewrite, null);
  assert.equal(short.scope, "account");
  assert.equal(short.product_id, null);
  const long = skillRowFromDismissal("acc", "prod", reason, { skill: "Skip sales tax nexus alerts; Etsy collects as a marketplace facilitator.", scope: "family" });
  assert.equal(long.text, reason);
  assert.equal(long.rewrite, "Skip sales tax nexus alerts; Etsy collects as a marketplace facilitator.");
});

test("no model answer still stores the seller's reason, scoped to the product", () => {
  const row = skillRowFromDismissal("acc", "prod", "We hold a CPC for this item, tested in March 2026.", null);
  assert.equal(row.scope, "product");
  assert.equal(row.product_id, "prod");
  assert.equal(row.rewrite, null);
});
