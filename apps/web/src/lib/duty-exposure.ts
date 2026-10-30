// Deterministic duty exposure for a product: the duty layers that stack on an
// import, from data already on the product. No model. Pure, no I/O, unit-tested,
// and bundled into the extension (see extension/build.mjs) so both surfaces agree.
//
// Layers:
//   general     the general (MFN) column rate for the heading, read from hts.usitc.gov
//               by hts-rate.ts. "read" when the schedule page parsed, else unknown.
//   section301  the Section 301 action on China-origin goods, by four-digit heading.
//               A seed table with the list and rate as of the date in the file; the
//               official search tool is linked. Seeds stay labelled seeds.
//   origin      country-based surcharges (the 2025 IEEPA actions, then the 2026
//               Section 122 tariff). These changed several times and were litigated,
//               so no number is assumed: the seller sets the rate they pay for this
//               product, or the layer stays "not set" and is excluded from the sum.
//
// A US-origin product has no import duty: every layer is "none" and the stacked
// rate is 0.

export type DutyLayerKey = "general" | "section301" | "origin";
export type DutyLayerStatus = "read" | "seed" | "set" | "none" | "unknown";

export interface DutyLayer {
  key: DutyLayerKey;
  label: string;
  /** Percent of customs value; null when unknown or not set. */
  rate_pct: number | null;
  status: DutyLayerStatus;
  /** Hostname of the source behind the figure. */
  source: string;
  url: string | null;
  as_of: string | null;
  /** One plain sentence for the UI. */
  note: string;
}

export interface DutyExposure {
  origin: string | null;
  heading: string | null;
  /** True when the product is made in the United States. */
  domestic: boolean;
  layers: DutyLayer[];
  /** Sum of the layers with a number (read, seed, set). */
  known_pct: number;
  /** Known layers beyond the general rate, in points: what reprice() sees as the duty change. */
  additional_pts: number;
  /** Layers that have no number yet. */
  unknown: DutyLayerKey[];
  /** True when every layer has a number (or is none). */
  complete: boolean;
  /** "Free + 25% Section 301 List 3 (seed), origin surcharge not set" */
  summary: string;
}

export interface Section301Seed {
  /** "1", "2", "3", "4A", "4B suspended", "2024 review", "excluded" */
  list: string;
  rate_pct: number;
  note?: string;
}

/**
 * Section 301 (China) action rates by four-digit heading, seed values.
 * Source: USTR Section 301 tariff action search tool. Rates after the 2024
 * four-year review schedule (some increases took effect 2025-01-01 and
 * 2026-01-01). Headings missing here are "not in the seed table", never 0.
 * Verify the eight-digit line on ustr.gov before relying on a figure.
 */
export const SECTION_301_AS_OF = "2026-01-01";
export const SECTION_301_URL = "https://ustr.gov/issue-areas/enforcement/section-301-investigations/search";

export const SECTION_301_SEEDS: Record<string, Section301Seed> = {
  // Toys and games
  "9503": { list: "4B suspended", rate_pct: 0, note: "List 4B never took effect; no Section 301 duty on toys." },
  // Lighting and electrical
  "9405": { list: "3", rate_pct: 25, note: "Most lamp lines; some LED lines moved between lists, check the eight-digit line." },
  "8513": { list: "3", rate_pct: 25 },
  "8504": { list: "1", rate_pct: 25 },
  "8507": { list: "2024 review", rate_pct: 25, note: "Lithium-ion batteries other than for vehicles rose from 7.5% to 25% on 2026-01-01." },
  "8473": { list: "3", rate_pct: 25 },
  "8543": { list: "3", rate_pct: 25 },
  "8516": { list: "4A", rate_pct: 7.5 },
  "8509": { list: "4A", rate_pct: 7.5 },
  "9013": { list: "3", rate_pct: 25 },
  "9018": { list: "3", rate_pct: 25, note: "Syringes and needles rose to 100% in the 2024 review." },
  // Wearables and accessories
  "9004": { list: "4A", rate_pct: 7.5 },
  "9102": { list: "4A", rate_pct: 7.5 },
  "6109": { list: "4A", rate_pct: 7.5 },
  "6110": { list: "4A", rate_pct: 7.5 },
  "6104": { list: "4A", rate_pct: 7.5 },
  "6103": { list: "4A", rate_pct: 7.5 },
  "6204": { list: "4A", rate_pct: 7.5 },
  "6203": { list: "4A", rate_pct: 7.5 },
  "6205": { list: "4A", rate_pct: 7.5 },
  "6206": { list: "4A", rate_pct: 7.5 },
  "6201": { list: "4A", rate_pct: 7.5 },
  "6202": { list: "4A", rate_pct: 7.5 },
  "6212": { list: "4A", rate_pct: 7.5 },
  "6108": { list: "4A", rate_pct: 7.5 },
  "6208": { list: "4A", rate_pct: 7.5 },
  "6107": { list: "4A", rate_pct: 7.5 },
  "6111": { list: "4A", rate_pct: 7.5 },
  "6209": { list: "4A", rate_pct: 7.5 },
  "6117": { list: "4A", rate_pct: 7.5 },
  "6214": { list: "4A", rate_pct: 7.5 },
  "6505": { list: "4A", rate_pct: 7.5 },
  "6116": { list: "4A", rate_pct: 7.5 },
  "6216": { list: "4A", rate_pct: 7.5 },
  "4203": { list: "4A", rate_pct: 7.5 },
  "6403": { list: "4A", rate_pct: 7.5 },
  "6404": { list: "4A", rate_pct: 7.5 },
  "4202": { list: "3", rate_pct: 25 },
  "7113": { list: "4A", rate_pct: 7.5 },
  // Personal care
  "3304": { list: "4A", rate_pct: 7.5 },
  "3305": { list: "4A", rate_pct: 7.5 },
  "3401": { list: "4A", rate_pct: 7.5 },
  "3307": { list: "4A", rate_pct: 7.5 },
  "3303": { list: "4A", rate_pct: 7.5 },
  "3004": { list: "excluded", rate_pct: 0, note: "Medicaments were left off every list." },
  // Home and kitchen
  "4201": { list: "3", rate_pct: 25 },
  "4016": { list: "3", rate_pct: 25 },
  "3924": { list: "3", rate_pct: 25 },
  "3926": { list: "3", rate_pct: 25 },
  "4419": { list: "3", rate_pct: 25 },
  "4420": { list: "3", rate_pct: 25 },
  "4421": { list: "3", rate_pct: 25 },
  "6307": { list: "3", rate_pct: 25, note: "Face masks under 6307.90 rose to 50% on 2026-01-01." },
  "5806": { list: "3", rate_pct: 25 },
  "9403": { list: "3", rate_pct: 25 },
  "9404": { list: "3", rate_pct: 25 },
  "6912": { list: "3", rate_pct: 25, note: "Ceramic tableware; check the eight-digit line, some lines were excluded." },
  "6911": { list: "3", rate_pct: 25, note: "Porcelain tableware; check the eight-digit line, some lines were excluded." },
  "7323": { list: "3", rate_pct: 25 },
  "7615": { list: "3", rate_pct: 25 },
  "8211": { list: "3", rate_pct: 25 },
  "8306": { list: "3", rate_pct: 25 },
  "9603": { list: "3", rate_pct: 25 },
  "4911": { list: "3", rate_pct: 25 },
  "4820": { list: "3", rate_pct: 25 },
  "4823": { list: "3", rate_pct: 25 },
  "7009": { list: "3", rate_pct: 25 },
  "7018": { list: "3", rate_pct: 25 },
  "8302": { list: "3", rate_pct: 25 },
  "7326": { list: "3", rate_pct: 25 },
};

export const ORIGIN_SURCHARGE_URL = "https://www.cbp.gov/trade/programs-administration/trade-remedies";

export interface DutyExposureInput {
  /** ISO 3166-1 alpha-2, the merged profile's origin. */
  origin_country: string | null | undefined;
  /** Four-digit heading, the first HTS candidate. */
  heading: string | null | undefined;
  /** What hts-rate.ts read for the heading, when it ran. */
  duty_rate?: { general: string | null; general_pct: number | null; verified: boolean; url?: string | null; read_at?: string; label?: string } | null;
  /** Seller-set origin surcharge for this product, percent of customs value. */
  surcharge_pct?: number | null;
}

function pct(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1).replace(/\.0$/, "")}%`;
}

export function dutyExposure(input: DutyExposureInput): DutyExposure {
  const origin = input.origin_country ? input.origin_country.toUpperCase() : null;
  const heading = input.heading ? input.heading.replace(/\D/g, "").slice(0, 4) || null : null;
  const domestic = origin === "US";
  const layers: DutyLayer[] = [];

  // 1. General rate, read from the schedule.
  const dr = input.duty_rate ?? null;
  if (domestic) {
    layers.push({ key: "general", label: "General duty", rate_pct: 0, status: "none", source: "hts.usitc.gov", url: null, as_of: null, note: "Made in the United States, so no import duty applies." });
  } else if (dr?.verified && dr.general_pct != null) {
    layers.push({ key: "general", label: "General duty", rate_pct: dr.general_pct, status: "read", source: "hts.usitc.gov", url: dr.url ?? null, as_of: dr.read_at ? dr.read_at.slice(0, 10) : null, note: `General column ${dr.general ?? pct(dr.general_pct)} for heading ${heading ?? "unknown"}, read from hts.usitc.gov.` });
  } else if (dr?.verified && dr.general) {
    layers.push({ key: "general", label: "General duty", rate_pct: null, status: "unknown", source: "hts.usitc.gov", url: dr.url ?? null, as_of: dr.read_at ? dr.read_at.slice(0, 10) : null, note: `General column is ${dr.general}, a specific or compound rate that does not reduce to a percent.` });
  } else {
    layers.push({ key: "general", label: "General duty", rate_pct: null, status: "unknown", source: "hts.usitc.gov", url: null, as_of: null, note: heading ? `General rate for heading ${heading} not read yet.` : "No tariff heading yet." });
  }

  // 2. Section 301, China only.
  if (domestic || !origin) {
    layers.push({ key: "section301", label: "Section 301", rate_pct: 0, status: "none", source: "ustr.gov", url: SECTION_301_URL, as_of: null, note: domestic ? "Not an import." : "Set the country of origin; Section 301 applies to goods of China." });
  } else if (origin !== "CN") {
    layers.push({ key: "section301", label: "Section 301", rate_pct: 0, status: "none", source: "ustr.gov", url: SECTION_301_URL, as_of: null, note: "Section 301 China actions do not apply to this origin." });
  } else {
    const seed = heading ? SECTION_301_SEEDS[heading] : undefined;
    if (seed) {
      layers.push({ key: "section301", label: `Section 301 List ${seed.list}`, rate_pct: seed.rate_pct, status: "seed", source: "ustr.gov", url: SECTION_301_URL, as_of: SECTION_301_AS_OF, note: `${seed.note ? `${seed.note} ` : ""}Seed value as of ${SECTION_301_AS_OF}; verify the eight-digit line on ustr.gov.`.trim() });
    } else {
      layers.push({ key: "section301", label: "Section 301", rate_pct: null, status: "unknown", source: "ustr.gov", url: SECTION_301_URL, as_of: null, note: heading ? `Heading ${heading} is not in the seed table; look it up on ustr.gov.` : "No tariff heading yet." });
    }
  }

  // 3. Country-based surcharge, seller-set.
  if (domestic) {
    layers.push({ key: "origin", label: "Origin surcharge", rate_pct: 0, status: "none", source: "cbp.gov", url: null, as_of: null, note: "Not an import." });
  } else if (input.surcharge_pct != null && Number.isFinite(input.surcharge_pct)) {
    layers.push({ key: "origin", label: "Origin surcharge", rate_pct: input.surcharge_pct, status: "set", source: "set by you", url: ORIGIN_SURCHARGE_URL, as_of: null, note: `Set for this product at ${pct(input.surcharge_pct)} of customs value.` });
  } else {
    layers.push({ key: "origin", label: "Origin surcharge", rate_pct: null, status: "unknown", source: "cbp.gov", url: ORIGIN_SURCHARGE_URL, as_of: null, note: "Country-based surcharges changed several times in 2025 and 2026. Set the rate you pay for this product, or check cbp.gov." });
  }

  const known = layers.filter((l) => l.rate_pct != null);
  const known_pct = Math.round(known.reduce((s, l) => s + (l.rate_pct ?? 0), 0) * 100) / 100;
  const additional_pts = Math.round(known.filter((l) => l.key !== "general").reduce((s, l) => s + (l.rate_pct ?? 0), 0) * 100) / 100;
  const unknown = layers.filter((l) => l.rate_pct == null).map((l) => l.key);

  const knownParts: string[] = [];
  const unknownParts: string[] = [];
  for (const l of layers) {
    if (l.status === "none" && l.key !== "general") continue;
    if (l.rate_pct == null) {
      unknownParts.push(l.key === "origin" ? "origin surcharge not set" : l.key === "section301" ? "Section 301 not in seed table" : "general rate not read");
      continue;
    }
    if (l.key === "general") knownParts.push(domestic ? "no import duty" : `${l.rate_pct === 0 ? "Free" : pct(l.rate_pct)} general`);
    else if (l.rate_pct === 0) knownParts.push(`no ${l.label}${l.status === "seed" ? " (seed)" : ""}`);
    else knownParts.push(`${pct(l.rate_pct)} ${l.label}${l.status === "seed" ? " (seed)" : ""}`);
  }
  const summary = domestic ? "Made in the United States, no import duty" : `${knownParts.join(" + ")}${unknownParts.length ? `, ${unknownParts.join(", ")}` : ""}`;

  return { origin, heading, domestic, layers, known_pct, additional_pts, unknown, complete: unknown.length === 0, summary };
}

/** "17.5%" when complete, "7.5%+" when a layer is still unknown, "0%" for US origin. */
export function stackedRateLabel(e: DutyExposure): string {
  if (e.domestic) return "0%";
  if (e.known_pct === 0 && e.unknown.length > 0) return "Unknown";
  return `${pct(e.known_pct)}${e.complete ? "" : "+"}`;
}

/** Duty dollars inside one unit at the stacked rate: landed cost x customs share x rate. */
export function dutyPerUnit(e: DutyExposure, landedCost: number, dutiableShare: number): number {
  if (!Number.isFinite(landedCost) || landedCost <= 0) return 0;
  const share = Math.min(Math.max(dutiableShare, 0), 1);
  return Math.round(landedCost * share * (e.known_pct / 100) * 100) / 100;
}
