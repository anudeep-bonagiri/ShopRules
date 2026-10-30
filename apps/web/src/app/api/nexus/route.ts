import { currentAccount, fail, json } from "@/lib/account";
import { listNexusVerifications } from "@/lib/db";
import { NEXUS_AS_OF, NEXUS_SEEDS } from "@/lib/nexus";

export const dynamic = "force-dynamic";

// Seed thresholds for every jurisdiction plus whatever this workspace has
// verified on the state revenue sites (Tavily Map, Crawl, Extract; no model).
export async function GET() {
  try {
    const account = await currentAccount();
    const verifications = await listNexusVerifications(account.id);
    return json({ as_of: NEXUS_AS_OF, seeds: NEXUS_SEEDS, verifications });
  } catch (err) {
    return fail(err);
  }
}
