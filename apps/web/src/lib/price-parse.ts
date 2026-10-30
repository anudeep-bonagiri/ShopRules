// Reads a listing price out of page content without a model. Order of trust:
// a Shopify product .json document, JSON-LD offers, Open Graph price meta,
// then the first currency amount in the text. Used by the daily price refresh
// (apps/web/src/lib/prices.ts) and unit-tested against fixture pages. The same
// parsePrice rules live in extension/src/extract.ts for the DOM path.

export interface ParsedPrice {
  price: number;
  currency: string | null;
  /** How the price was found; the UI shows "verify" for text matches. */
  method: "shopify_json" | "json_ld" | "open_graph" | "text";
  confidence: number; // 0..1
}

export function parsePriceNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const compact = raw.replace(/\u00a0/g, " ").replace(/(\d)[ ](?=\d{3}\b)/g, "$1");
  const m = compact.match(/\d+(?:[.,]\d+)*/);
  if (!m) return null;
  let s = m[0];
  const lastSep = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  if (lastSep >= 0) {
    const decimals = s.length - lastSep - 1;
    const integer = s.slice(0, lastSep).replace(/[.,]/g, "");
    s = decimals <= 2 ? `${integer}.${s.slice(lastSep + 1)}` : integer + s.slice(lastSep + 1);
  }
  const value = Number(s);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

const CURRENCY_MARKS: Array<[RegExp, string]> = [
  [/US\s?\$/, "USD"],
  [/(?:CA|C)\s?\$/, "CAD"],
  [/(?:AU|A)\s?\$/, "AUD"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/¥/, "JPY"],
  [/₹/, "INR"],
  [/\b(USD|EUR|GBP|CAD|AUD|JPY|INR|MXN|BRL|SEK|NOK|DKK|PLN|CHF|NZD|HKD|SGD)\b/, ""],
  [/\$/, "USD"],
];

export function currencyFromText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const [pattern, code] of CURRENCY_MARKS) {
    const m = raw.match(pattern);
    if (m) return code || m[1] || null;
  }
  return null;
}

/** Shopify's public /products/<handle>.json (or .js) document. */
export function priceFromShopifyJson(doc: unknown): ParsedPrice | null {
  const product = (doc as { product?: unknown })?.product ?? doc;
  if (!product || typeof product !== "object") return null;
  const p = product as { variants?: Array<{ price?: string | number; available?: boolean }>; price?: number; price_min?: number };
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const available = variants.find((v) => v.available !== false && v.price != null) ?? variants[0];
  let raw: string | number | null | undefined = available?.price;
  // /products/<handle>.js reports prices in cents.
  if (raw == null && typeof p.price === "number") raw = p.price / 100;
  if (raw == null && typeof p.price_min === "number") raw = p.price_min / 100;
  const price = parsePriceNumber(raw);
  return price === null ? null : { price, currency: null, method: "shopify_json", confidence: 0.98 };
}

type Node = Record<string, unknown>;

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function findProductNode(node: unknown, depth = 0): Node | null {
  if (node === null || node === undefined || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const f = findProductNode(item, depth + 1);
      if (f) return f;
    }
    return null;
  }
  if (!isNode(node)) return null;
  const t = node["@type"];
  const types: unknown[] = Array.isArray(t) ? t : [t];
  if (types.some((x) => typeof x === "string" && /^(Product|ProductModel|IndividualProduct|ProductGroup)$/i.test(x))) return node;
  return findProductNode(node["@graph"], depth + 1) ?? findProductNode(node.mainEntity, depth + 1);
}

function firstOffer(offers: unknown): Node | null {
  if (!offers) return null;
  if (Array.isArray(offers)) return isNode(offers[0]) ? offers[0] : null;
  if (isNode(offers)) return offers.offers ? (firstOffer(offers.offers) ?? offers) : offers;
  return null;
}

export function priceFromJsonLd(html: string): ParsedPrice | null {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const node = findProductNode(data);
    if (!node) continue;
    const offer = firstOffer(node.offers);
    if (!offer) continue;
    const spec = isNode(offer.priceSpecification) ? offer.priceSpecification : null;
    const raw = offer.price ?? offer.lowPrice ?? spec?.price;
    const price = parsePriceNumber(typeof raw === "string" || typeof raw === "number" ? raw : null);
    if (price === null) continue;
    const currency = typeof offer.priceCurrency === "string" ? offer.priceCurrency : typeof spec?.priceCurrency === "string" ? spec.priceCurrency : null;
    return { price, currency, method: "json_ld", confidence: 0.95 };
  }
  return null;
}

function metaContent(html: string, property: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const c = tag.match(/content\s*=\s*["']([^"']*)["']/i);
  return c ? c[1] : null;
}

export function priceFromOpenGraph(html: string): ParsedPrice | null {
  const raw = metaContent(html, "og:price:amount") ?? metaContent(html, "product:price:amount");
  const price = parsePriceNumber(raw);
  if (price === null) return null;
  const currency = metaContent(html, "og:price:currency") ?? metaContent(html, "product:price:currency") ?? currencyFromText(raw);
  return { price, currency, method: "open_graph", confidence: 0.9 };
}

/** First currency amount in plain text or markdown; low confidence, the caller sanity-checks it against the last known price. */
export function priceFromText(text: string, hint?: { near?: number | null }): ParsedPrice | null {
  const re = /(?:US\$|CA\$|A\$|\$|€|£|¥|₹)\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{1,2})?)/g;
  const found: Array<{ price: number; currency: string | null }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && found.length < 40) {
    const price = parsePriceNumber(m[1]);
    if (price !== null) found.push({ price, currency: currencyFromText(m[0]) });
  }
  if (found.length === 0) return null;
  // Prefer the amount closest to the last known price when we have one; a page lists
  // shipping, savings, and related items too.
  const near = hint?.near;
  const pick = near != null && Number.isFinite(near) ? found.reduce((best, f) => (Math.abs(f.price - near) < Math.abs(best.price - near) ? f : best), found[0]) : found[0];
  return { price: pick.price, currency: pick.currency, method: "text", confidence: near != null ? 0.6 : 0.4 };
}

/** Best price from an HTML or markdown document. */
export function parsePriceFromContent(content: string, hint?: { near?: number | null }): ParsedPrice | null {
  if (!content) return null;
  if (/<\s*(html|head|body|meta|script)/i.test(content)) {
    const ld = priceFromJsonLd(content);
    if (ld) return ld;
    const og = priceFromOpenGraph(content);
    if (og) return og;
  }
  return priceFromText(content, hint);
}

/** A new observation is only a real change when it moves by at least a cent and is not wildly off. */
export function isPlausibleMove(previous: number | null, next: number): boolean {
  if (!Number.isFinite(next) || next <= 0) return false;
  if (previous === null || previous <= 0) return true;
  const ratio = next / previous;
  return ratio >= 0.4 && ratio <= 2.5;
}

export function changedByACent(previous: number | null, next: number): boolean {
  return previous === null || Math.abs(next - previous) >= 0.01;
}
