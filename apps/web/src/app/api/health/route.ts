import { dbConfigured } from "@/lib/db";
import { nemotronConfigured, MODELS } from "@/lib/nemotron";
import { tavilyMode } from "@/lib/tavily";
import { json } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({
    ok: true,
    version: "0.1.0",
    tavily_mode: tavilyMode(),
    nemotron_configured: nemotronConfigured(),
    storage_configured: dbConfigured(),
    models: MODELS,
  });
}
