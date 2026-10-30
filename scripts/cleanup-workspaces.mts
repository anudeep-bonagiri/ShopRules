// Deletes test workspaces from the Blob store. Keeps any ids listed in KEEP
// (comma separated). Run from the repo root with the web app's env loaded:
//
//   set -a && . ./apps/web/.env.local && set +a && KEEP=<id1>,<id2> npx -y tsx@4.19.4 scripts/cleanup-workspaces.mts
//
// Without CONFIRM=1 it only lists what it would delete.

import * as dbNs from "../apps/web/src/lib/db";
const db = ((dbNs as { default?: unknown }).default ?? dbNs) as Record<string, any>;

const keep = new Set((process.env.KEEP ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const ids: string[] = await db.listAccountIds();
console.log(`${ids.length} workspaces, keeping ${keep.size}`);
for (const id of ids) {
  if (keep.has(id)) {
    console.log("keep  ", id);
    continue;
  }
  let summary = "";
  try {
    const products = await db.listProducts(id);
    summary = `${products.length} products`;
  } catch {
    summary = "unreadable";
  }
  if (process.env.CONFIRM === "1") {
    await db.deleteAccount(id);
    console.log("deleted", id, summary);
  } else {
    console.log("would delete", id, summary);
  }
}
