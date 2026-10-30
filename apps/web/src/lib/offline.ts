// Offline mode: lets the whole product run on a laptop with no keys. Storage
// falls back to a file-backed store that mimics Vercel Blob, Nemotron calls are
// answered from recorded fixtures, and Tavily returns the recorded official
// excerpts. Everything downstream (verifier, guardrails, pricing, UI) is the
// real code. Never active in production unless SR_OFFLINE=1 is set on purpose.

export interface OfflineMode {
  store: "blob" | "local";
  models: "live" | "canned";
  tavily: "live" | "canned";
}

export function offlineMode(): OfflineMode {
  const forced = process.env.SR_OFFLINE === "1";
  const dev = process.env.NODE_ENV !== "production";
  const store: OfflineMode["store"] = forced || process.env.SR_LOCAL_STORE === "1" || (dev && !process.env.BLOB_READ_WRITE_TOKEN) ? "local" : "blob";
  const models: OfflineMode["models"] = forced || process.env.SR_FAKE_MODELS === "1" || (dev && !process.env.NEBIUS_API_KEY) ? "canned" : "live";
  const tavily: OfflineMode["tavily"] = forced || process.env.SR_FAKE_TAVILY === "1" || (models === "canned" && !process.env.TAVILY_API_KEY) ? "canned" : "live";
  return { store, models, tavily };
}

export function localStoreDir(): string {
  return process.env.SR_LOCAL_STORE_DIR || `${process.cwd()}/.sr-data`;
}
