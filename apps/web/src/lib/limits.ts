// Daily caps on the paid endpoints, per workspace. Counts live in the
// workspace document (AccountRow.usage) so they survive deploys and cannot be
// reset by clearing a cookie. Env overrides: SR_LIMIT_CHECKS, SR_LIMIT_INGESTS,
// SR_LIMIT_COMPARES (0 disables that cap).

export type LimitKind = "checks" | "ingests" | "compares";

export const DEFAULT_LIMITS: Record<LimitKind, number> = { checks: 40, ingests: 10, compares: 20 };

export function limitFor(kind: LimitKind, env: Record<string, string | undefined> = process.env): number {
  const raw = env[`SR_LIMIT_${kind.toUpperCase()}`];
  if (raw === undefined || raw === "") return DEFAULT_LIMITS[kind];
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_LIMITS[kind];
}

export function usageKey(kind: LimitKind, day = new Date()): string {
  return `${day.toISOString().slice(0, 10)}:${kind}`;
}

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  message: string | null;
}

const LABEL: Record<LimitKind, string> = { checks: "rule checks", ingests: "new products", compares: "price comparisons" };

/** Pure decision for the current usage; the caller increments on allow. */
export function decideQuota(kind: LimitKind, used: number, limit: number, cost = 1): QuotaDecision {
  if (limit === 0) return { allowed: true, used, limit, remaining: Number.POSITIVE_INFINITY, message: null };
  const remaining = Math.max(0, limit - used);
  if (used + cost > limit) {
    return {
      allowed: false,
      used,
      limit,
      remaining,
      message: `Daily limit reached: ${limit} ${LABEL[kind]} per workspace per day on this deployment. It resets at midnight UTC. Self-host to raise it.`,
    };
  }
  return { allowed: true, used, limit, remaining: remaining - cost, message: null };
}

/** Drops counters older than yesterday so the usage map stays tiny. */
export function pruneUsage(usage: Record<string, number>, today = new Date()): Record<string, number> {
  const keep = new Set([today.toISOString().slice(0, 10), new Date(today.getTime() - 86400000).toISOString().slice(0, 10)]);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(usage)) if (keep.has(k.slice(0, 10))) out[k] = v;
  return out;
}
