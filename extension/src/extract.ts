// Reads a product out of the page DOM. Order of trust: JSON-LD Product,
// Open Graph meta, then marketplace-specific selectors.
import type { FieldConfidence, FieldSource, Marketplace, PageProduct } from "./types";

export interface CardProduct {
  url: string;
  title: string | null;
  price: number | null;
  currency: string | null;
  image: string | null;
}

const PRODUCT_LINK = 'a[href*="/dp/"], a[href*="/listing/"], a[href*="/products/"]';
const KNOWN_CARDS =
  '[data-component-type="s-search-result"], [data-asin]:not([data-asin=""]), [data-listing-id], ' +
  ".v2-listing-card, .listing-link, .product-card, .card-wrapper, .grid__item, article, li";
const MAX_DESCRIPTION = 2000;
const MAX_WALK = 14;
// Amazon search results carry the ASIN on the card itself; no link counting needed.
const AMAZON_CARD = '[data-component-type="s-search-result"][data-asin], .s-result-item[data-asin], [data-asin][data-index]';
// Card title candidates, most specific first. Overlay buttons ("Preview seller",
// "Add to cart") and shop links are never titles.
const CARD_TITLE_SELECTORS = ["[data-listing-card-title]", ".v2-listing-card__title", "h3", "h2", "h4", '[class*="title"]', '[class*="name"]'];
const NOT_TITLE_WITHIN = 'button, [role="button"], a[href*="/shop/"], [aria-hidden="true"], .wt-screen-reader-only, [class*="screen-reader"], [class*="sr-only"]';
const JUNK_TITLE = /^(preview seller|add to cart|add to basket|add to favou?rites?|favou?rite|remove from favou?rites?|sponsored|ad by .{0,60}|ad from .{0,60}|quick view|see more|see options|more like this|shop now|buy now|etsy'?s pick|bestseller|best seller|popular now|free shipping.{0,40}|sale|new|options|\d+ reviews?)$/i;

// Marketplace and page detection

export function detectMarketplace(doc: Document = document, loc: Location = location): Marketplace {
  const host = loc.hostname.toLowerCase();
  if (/(^|\.)amazon\.[a-z.]+$/.test(host)) return "amazon";
  if (/(^|\.)etsy\.com$/.test(host)) return "etsy";
  if (host.endsWith(".myshopify.com") || looksLikeShopify(doc, loc)) return "shopify";
  return "other";
}

// Shopify on a custom domain: the Shopify global, the checkout token meta, or a
// /products/<handle> path served with /cdn/shop/ assets.
export function looksLikeShopify(doc: Document, loc: Location, win: Window | null = typeof window !== "undefined" ? window : null): boolean {
  if (win && "Shopify" in win && (win as unknown as { Shopify?: unknown }).Shopify) return true;
  if (doc.querySelector('meta[name="shopify-checkout-api-token"], meta[name="shopify-digital-wallet"], meta[name^="shopify-"]')) return true;
  const hasShopAssets = doc.querySelector('link[href*="/cdn/shop/"], script[src*="/cdn/shop/"], img[src*="/cdn/shop/"], link[href*="cdn.shopify.com"], script[src*="cdn.shopify.com"]') !== null;
  if (/\/products\/[^/?#]+/.test(loc.pathname) && hasShopAssets) return true;
  if (hasShopAssets && /\/(collections|products|cart)(\/|$)/.test(loc.pathname)) return true;
  const scripts = Array.from(doc.scripts).slice(0, 60);
  return scripts.some((script) => !script.src && /Shopify\.(shop|theme|routes)/.test(script.textContent ?? ""));
}

export function isProductPage(market: Marketplace, doc: Document = document, loc: Location = location): boolean {
  const path = loc.pathname;
  switch (market) {
    case "amazon":
      return /\/(dp|gp\/product)\/[A-Z0-9]{10}/i.test(path) || doc.querySelector("#productTitle") !== null;
    case "etsy":
      return /\/listing\/\d+/.test(path);
    case "shopify":
      return /\/products\/[^/?#]+/.test(path);
    default:
      return findLdProduct(doc) !== null || meta(doc, 'meta[property="og:type"]') === "product";
  }
}

// Normalises listing URLs so the page, its cards, and the server all agree
// on one URL per product.
export function canonicalProductUrl(href: string, market: Marketplace): string | null {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    return null;
  }
  if (market === "amazon") {
    let path = url.pathname;
    // Sponsored results link through /sspa/click?...&url=%2FName%2Fdp%2FASIN%2F...
    if (/\/sspa\/click/.test(path)) {
      const inner = url.searchParams.get("url");
      if (inner) {
        try {
          path = new URL(inner, url.origin).pathname;
        } catch {
          path = inner;
        }
      }
    }
    const m = path.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return m?.[1] ? `${url.origin}/dp/${m[1].toUpperCase()}` : null;
  }
  if (market === "etsy") {
    const m = url.pathname.match(/\/listing\/(\d+)(?:\/([^/?#]+))?/);
    if (!m?.[1]) return null;
    return `${url.origin}/listing/${m[1]}${m[2] ? `/${m[2]}` : ""}`;
  }
  if (market === "shopify") {
    const m = url.pathname.match(/\/products\/([^/?#]+)/);
    return m?.[1] ? `${url.origin}/products/${m[1]}` : null;
  }
  return `${url.origin}${url.pathname}`;
}

function pageUrl(market: Marketplace, doc: Document): string {
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  if (canonical) {
    try {
      if (new URL(canonical).hostname === location.hostname) {
        const cleaned = canonicalProductUrl(canonical, market);
        if (cleaned) return cleaned;
      }
    } catch {
      // Ignore a malformed canonical link and fall through to the address bar.
    }
  }
  return canonicalProductUrl(location.href, market) ?? `${location.origin}${location.pathname}`;
}

// Page product

export function extractPageProduct(market: Marketplace, doc: Document = document): PageProduct {
  const layers: Array<[FieldSource, Layer]> = [
    ["json_ld", fromJsonLd(doc)],
    ["open_graph", fromOpenGraph(doc)],
    ["selectors", fromSelectors(market, doc)],
  ];
  const pick = <K extends Field>(key: K): [NonNullable<Layer[K]> | null, FieldSource | undefined] => {
    for (const [source, layer] of layers) {
      const value = layer[key];
      if (value !== undefined && value !== null && value !== "") return [value as NonNullable<Layer[K]>, source];
    }
    return [null, undefined];
  };
  const [title, titleSrc] = pick("title");
  const [price, priceSrc] = pick("price");
  const [currency, currencySrc] = pick("currency");
  const [description, descriptionSrc] = pick("description");
  const [materialsRaw, materialsSrc] = pick("materials");
  const [image, imageSrc_] = pick("image");
  const confidence: FieldConfidence = {};
  if (titleSrc) confidence.title = titleSrc;
  else if (pageTitle(doc)) confidence.title = "text";
  if (priceSrc) confidence.price = priceSrc;
  if (currencySrc) confidence.currency = currencySrc;
  if (descriptionSrc) confidence.description = descriptionSrc;
  // A materials label can sit in any layer's description, not only the winning one.
  const materialsText = materialsRaw ?? layers.map(([, l]) => materialsFromText(l.description ?? null)).find(Boolean) ?? materialsFromText(description);
  if (materialsSrc) confidence.materials = materialsSrc;
  else if (materialsText) confidence.materials = "text";
  if (imageSrc_) confidence.image = imageSrc_;
  return {
    url: pageUrl(market, doc),
    title: title ?? pageTitle(doc),
    price,
    currency,
    description,
    materials: splitMaterials(materialsText),
    image,
    confidence,
  };
}

// Shopify exposes every product as public JSON at /products/<handle>.json:
// exact price and variants, images, product_type, tags, vendor. Preferred over
// the DOM when it answers; the DOM result fills any gap.
export interface ShopifyProductJson {
  product?: {
    title?: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
    tags?: string | string[];
    variants?: Array<{ price?: string | number; available?: boolean; title?: string }>;
    images?: Array<{ src?: string }>;
    image?: { src?: string } | null;
  };
}

export function productFromShopifyJson(doc: ShopifyProductJson, url: string, dom: PageProduct | null): PageProduct | null {
  const p = doc?.product;
  if (!p || typeof p !== "object") return null;
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const variant = variants.find((v) => v.available !== false && v.price != null) ?? variants[0];
  const price = parsePrice(variant?.price != null ? String(variant.price) : null);
  const tags = Array.isArray(p.tags) ? p.tags : typeof p.tags === "string" ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const description = truncate(stripHtml(p.body_html ?? "")) ?? dom?.description ?? null;
  const image = p.image?.src ?? p.images?.[0]?.src ?? dom?.image ?? null;
  const confidence: FieldConfidence = { ...(dom?.confidence ?? {}) };
  if (p.title) confidence.title = "api";
  if (price !== null) confidence.price = "api";
  if (description) confidence.description = p.body_html ? "api" : confidence.description;
  if (image) confidence.image = p.image?.src || p.images?.[0]?.src ? "api" : confidence.image;
  const materialsRaw = materialsFromText(description) ?? dom?.materials?.join(", ") ?? null;
  if (materialsRaw) confidence.materials = materialsFromText(description) ? "text" : confidence.materials;
  return {
    url,
    title: clean(p.title) ?? dom?.title ?? null,
    price: price ?? dom?.price ?? null,
    currency: dom?.currency ?? null,
    description,
    materials: splitMaterials(materialsRaw),
    image,
    confidence,
    vendor: clean(p.vendor) ?? null,
    product_type: clean(p.product_type) ?? null,
    tags: tags.length ? tags.slice(0, 20) : null,
  };
}

export function shopifyJsonUrl(loc: Location = location): string | null {
  const m = loc.pathname.match(/^(.*\/products\/[^/?#]+)/);
  return m ? `${loc.origin}${m[1]}.json` : null;
}

export async function extractPageProductAsync(market: Marketplace, doc: Document = document, loc: Location = location): Promise<PageProduct> {
  const dom = extractPageProduct(market, doc);
  if (market !== "shopify") return dom;
  const jsonUrl = shopifyJsonUrl(loc);
  if (!jsonUrl) return dom;
  try {
    const res = await fetch(jsonUrl, { headers: { accept: "application/json" }, credentials: "omit" });
    if (!res.ok) return dom;
    const data = (await res.json()) as ShopifyProductJson;
    return productFromShopifyJson(data, dom.url, dom) ?? dom;
  } catch {
    return dom;
  }
}

function stripHtml(html: string): string | null {
  if (!html) return null;
  return clean(html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"'));
}

// The document title is the last resort. A bare hostname (bot walls, error
// pages) or a one-word title is not a product name.
function pageTitle(doc: Document): string | null {
  const title = clean(doc.title);
  if (!title || title.length < 3) return null;
  const host = location.hostname.toLowerCase().replace(/^www\./, "");
  const lowered = title.toLowerCase();
  return lowered === host || lowered === `www.${host}` ? null : title;
}

type Field = Exclude<keyof PageProduct, "url">;

// Raw layer: materials is still the text the markup gave us; it is split once at the end.
type Layer = Partial<Omit<PageProduct, "materials">> & { materials?: string | null };

// JSON-LD is free-form, so this walker takes `any` and checks shapes by hand.
/* eslint-disable @typescript-eslint/no-explicit-any */
function findLdProduct(doc: Document): any {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const found = findProductNode(data, 0);
    if (found) return found;
  }
  return null;
}

function findProductNode(node: any, depth: number): any {
  if (node === null || node === undefined || depth > 5) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const rawType = node["@type"];
  const types: unknown[] = Array.isArray(rawType) ? rawType : [rawType];
  if (types.some((t) => typeof t === "string" && /^(Product|ProductModel|IndividualProduct|ProductGroup)$/i.test(t))) {
    return node;
  }
  return findProductNode(node["@graph"], depth + 1) ?? findProductNode(node.mainEntity, depth + 1);
}

function firstOffer(offers: any): any {
  if (!offers) return null;
  if (Array.isArray(offers)) return offers[0] ?? null;
  if (typeof offers === "object" && offers.offers) return firstOffer(offers.offers) ?? offers;
  return offers;
}

function ldImage(image: any): string | null {
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return ldImage(image[0]);
  if (image && typeof image === "object") return str(image.url) ?? str(image.contentUrl);
  return null;
}

function ldList(value: any): string | null {
  if (Array.isArray(value)) return value.map((v) => str(typeof v === "object" && v ? v.name : v)).filter(Boolean).join(", ") || null;
  if (value && typeof value === "object") return str(value.name);
  return str(value);
}

function fromJsonLd(doc: Document): Layer {
  const node = findLdProduct(doc);
  if (!node) return {};
  const offer = firstOffer(node.offers);
  const spec = offer?.priceSpecification;
  const priceText = offer ? str(offer.price) ?? str(offer.lowPrice) ?? str(spec?.price) : null;
  return {
    title: str(node.name),
    description: truncate(str(node.description)),
    image: ldImage(node.image),
    price: parsePrice(priceText),
    currency: offer ? str(offer.priceCurrency) ?? str(spec?.priceCurrency) : null,
    materials: ldList(node.material),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function fromOpenGraph(doc: Document): Layer {
  const priceText = meta(doc, 'meta[property="og:price:amount"]') ?? meta(doc, 'meta[property="product:price:amount"]');
  return {
    title: meta(doc, 'meta[property="og:title"]'),
    price: parsePrice(priceText),
    currency:
      meta(doc, 'meta[property="og:price:currency"]') ??
      meta(doc, 'meta[property="product:price:currency"]') ??
      currencyFromText(priceText),
    image: meta(doc, 'meta[property="og:image"]'),
    description: truncate(meta(doc, 'meta[property="og:description"]')),
  };
}

function fromSelectors(market: Marketplace, doc: Document): Layer {
  switch (market) {
    case "amazon": {
      const priceText = firstText(doc, [
        "#corePrice_feature_div .a-price .a-offscreen",
        "#apex_desktop .a-price .a-offscreen",
        ".a-price .a-offscreen",
      ]);
      return {
        title: text(doc, "#productTitle"),
        price: parsePrice(priceText),
        currency: currencyFromText(priceText),
        description: truncate(joinText([text(doc, "#feature-bullets"), text(doc, "#productDescription")])),
        materials: labeledValue(
          doc,
          "#productOverview_feature_div tr, #productDetails_techSpec_section_1 tr, #detailBullets_feature_div li",
          /\bmaterial/i,
        ),
        image: imageSrc(doc, "#landingImage, #imgTagWrapperId img"),
      };
    }
    case "etsy": {
      const priceText = text(doc, '[data-buy-box-region="price"] p');
      return {
        title: text(doc, "h1[data-buy-box-listing-title]"),
        price: parsePrice(priceText),
        currency: currencyFromText(priceText),
        description: truncate(text(doc, "#wt-content-toggle-product-details-read-more")),
        image: imageSrc(doc, "img[data-listing-card-listing-image], .listing-page-image-carousel-component img"),
      };
    }
    case "shopify": {
      // Dawn classes first, then any theme's price element, then the first amount near the title.
      const priceText =
        meta(doc, 'meta[property="og:price:amount"]') ??
        firstText(doc, [".price-item--sale", ".price-item--regular", ".product__price", ".price", '[itemprop="price"]', '[data-product-price]', '[class*="ProductPrice"]', '[class*="product-price"]', '[class*="PdpPrice"]', '[class*="Price"]', '[class*="price"]']) ??
        priceNearTitle(doc);
      return {
        title: text(doc, "h1"),
        price: parsePrice(priceText),
        currency: meta(doc, 'meta[property="og:price:currency"]') ?? currencyFromText(priceText),
        description: truncate(
          firstText(doc, [".product__description", ".product-single__description", '[class*="product__description"]']),
        ),
        image: imageSrc(doc, ".product__media img, .product-single__photo img, .product__photo img"),
      };
    }
    default:
      return { title: text(doc, "h1"), image: imageSrc(doc, "main img") };
  }
}

// First currency amount in the text that follows the h1, for themes with no known price class.
function priceNearTitle(doc: Document): string | null {
  const h1 = doc.querySelector("h1");
  const scope = h1?.closest("main, section, article, div") ?? doc.body;
  const text = clean(scope?.textContent) ?? "";
  const after = h1 ? text.slice(Math.max(0, text.indexOf(clean(h1.textContent) ?? ""))) : text;
  const m = after.match(/(?:US\$|CA\$|A\$|\$|€|£|¥|₹)\s?\d[\d.,]*/);
  return m?.[0] ?? null;
}

// Product cards on search and collection pages

export function nearestProductCard(start: Element | null, market: Marketplace): CardProduct | null {
  const card = findProductCardElement(start, market);
  return card ? productFromCard(card, market) : null;
}

// The smallest card-sized ancestor of `start` that holds exactly one product link.
export function findProductCardElement(start: Element | null, market: Marketplace): Element | null {
  if (!start) return null;
  if (market === "amazon") {
    const amazon = start.closest(AMAZON_CARD);
    if (amazon && cardAsin(amazon)) return amazon;
  }
  const known = start.closest(KNOWN_CARDS);
  // A known wrapper can be an inner part of the card (Etsy puts data-listing-id
  // on the link block); grow to the outermost element that is still one product
  // so the price and title below the image are inside.
  if (known && isSingleProductCard(known, market)) return growToCard(known, market) ?? known;
  return walkToCard(start, market);
}

function cardAsin(card: Element): string | null {
  const asin = card.getAttribute("data-asin")?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : null;
}

export function productFromCard(card: Element, market: Marketplace): CardProduct | null {
  const asin = market === "amazon" ? cardAsin(card) : null;
  const url = asin ? `${location.origin}/dp/${asin}` : productUrlsWithin(card, market, 2)[0];
  if (!url) return null;
  const priceText = cardPriceText(card);
  return {
    url,
    title: cardTitle(card),
    price: parsePrice(priceText),
    currency: currencyFromText(priceText),
    image: cardImage(card),
  };
}

function walkToCard(start: Element, market: Marketplace): Element | null {
  let el: Element | null = start;
  for (let depth = 0; el && depth < MAX_WALK; depth++, el = el.parentElement) {
    if (el === document.body || el === document.documentElement) return null;
    if (productUrlsWithin(el, market, 1).length === 0) continue;
    return growToCard(el, market);
  }
  return null;
}

// From the first ancestor that holds a product link, keep climbing while the
// parent still holds exactly that one product and is still card-sized.
function growToCard(anchor: Element, market: Marketplace): Element | null {
  if (!isSingleProductCard(anchor, market)) return null;
  let card = anchor;
  let parent = card.parentElement;
  for (let depth = 0; parent && depth < MAX_WALK; depth++, parent = card.parentElement) {
    if (parent === document.body || !isSingleProductCard(parent, market)) break;
    card = parent;
  }
  return card;
}

function isSingleProductCard(el: Element, market: Marketplace): boolean {
  if (!(market === "amazon" && cardAsin(el)) && productUrlsWithin(el, market, 2).length !== 1) return false;
  const rect = el.getBoundingClientRect();
  const viewportArea = window.innerWidth * window.innerHeight;
  return rect.width > 40 && rect.height > 40 && rect.width * rect.height < viewportArea * 0.4 && rect.height < window.innerHeight * 0.8;
}

function productUrlsWithin(el: Element, market: Marketplace, limit: number): string[] {
  const urls: string[] = [];
  const links = el.matches(PRODUCT_LINK) ? [el as HTMLAnchorElement] : [];
  for (const link of [...links, ...Array.from(el.querySelectorAll<HTMLAnchorElement>(PRODUCT_LINK))]) {
    const url = canonicalProductUrl(link.href, market);
    if (url && !urls.includes(url)) {
      urls.push(url);
      if (urls.length >= limit) break;
    }
  }
  return urls;
}

// Text of an element with its buttons and screen-reader-only spans removed.
function textExcluding(el: Element, excludeSelector: string): string | null {
  const copy = el.cloneNode(true) as Element;
  for (const junk of Array.from(copy.querySelectorAll(excludeSelector))) junk.remove();
  return clean(copy.textContent);
}

function cardTitle(card: Element): string | null {
  for (const selector of CARD_TITLE_SELECTORS) {
    for (const el of Array.from(card.querySelectorAll(selector)).slice(0, 8)) {
      if (el.closest(NOT_TITLE_WITHIN)) continue;
      const t = textExcluding(el, NOT_TITLE_WITHIN);
      if (!t || t.length < 3 || JUNK_TITLE.test(t)) continue;
      return t.slice(0, 200);
    }
  }
  const img = card.querySelector<HTMLImageElement>("img[alt]");
  const alt = clean(img?.alt);
  if (alt) return alt.replace(/^sponsored ad\s*-\s*/i, "").slice(0, 200);
  const link = card.querySelector<HTMLAnchorElement>(PRODUCT_LINK);
  return clean(link?.getAttribute("aria-label") ?? link?.title ?? link?.textContent)?.slice(0, 200) ?? null;
}

function cardPriceText(card: Element): string | null {
  // Etsy: the current price, not the struck-through original on a sale card.
  const etsyValue = Array.from(card.querySelectorAll(".currency-value")).find((v) => !v.closest("s, del, .wt-text-strikethrough, [class*='strikethrough'], [class*='original-price']")) ?? card.querySelector(".currency-value");
  if (etsyValue) {
    const symbol = clean((etsyValue.parentElement?.querySelector(".currency-symbol") ?? card.querySelector(".currency-symbol"))?.textContent) ?? "";
    return `${symbol}${clean(etsyValue.textContent) ?? ""}`;
  }
  const direct = firstText(card, [
    ".a-price .a-offscreen",
    ".price-item--sale",
    ".price-item--regular",
    ".product-card__price",
    ".price",
    '[class*="price"]',
  ]);
  if (direct && /\d/.test(direct)) return direct;
  const m = clean(card.textContent)?.match(/(?:US\$|CA\$|A\$|\$|€|£|¥|₹)\s?\d[\d.,]*/);
  return m?.[0] ?? null;
}

function cardImage(card: Element): string | null {
  for (const img of Array.from(card.querySelectorAll<HTMLImageElement>("img"))) {
    const src = imageUrl(img);
    if (src) return src;
  }
  return null;
}

// Price and currency parsing

// Handles "$1,234.56", "US$12.00", "€12,34", "1.234,56", "1 234,56".
export function parsePrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const compact = raw.replace(/ /g, " ").replace(/(\d)[ ](?=\d{3}\b)/g, "$1");
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
  return Number.isFinite(value) ? value : null;
}

const CURRENCY_MARKS: Array<[RegExp, string]> = [
  [/US\s?\$/, "USD"],
  [/(?:CA|C)\s?\$/, "CAD"],
  [/(?:AU|A)\s?\$/, "AUD"],
  [/NZ\s?\$/, "NZD"],
  [/MX\s?\$/, "MXN"],
  [/HK\s?\$/, "HKD"],
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

function materialsFromText(description: string | null): string | null {
  const m = description?.match(/\bmaterials?\s*[:\-]\s*([^\n.;|]{2,120})/i);
  return clean(m?.[1]) ?? null;
}

// "Beech wood, water-based paint; cotton" -> ["beech wood", "water-based paint", "cotton"].
export function splitMaterials(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const parts = raw
    .split(/[,;|/]|\band\b|\s{2,}/i)
    .map((p) => p.replace(/^\s*(?:made (?:of|from|with)\s*)?/i, "").trim().toLowerCase())
    .filter((p) => p.length >= 2 && p.length <= 40);
  const unique = Array.from(new Set(parts)).slice(0, 10);
  return unique.length ? unique : null;
}

// DOM helpers

function str(value: unknown): string | null {
  if (typeof value === "string") return clean(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const out = value.replace(/[‎‏‪-‮]/g, "").replace(/\s+/g, " ").trim();
  return out || null;
}

function truncate(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > MAX_DESCRIPTION ? `${value.slice(0, MAX_DESCRIPTION)}...` : value;
}

function meta(doc: Document, selector: string): string | null {
  return clean(doc.querySelector<HTMLMetaElement>(selector)?.content);
}

function text(scope: ParentNode, selector: string): string | null {
  return clean(scope.querySelector(selector)?.textContent);
}

function firstText(scope: ParentNode, selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = text(scope, selector);
    if (value) return value;
  }
  return null;
}

function joinText(parts: Array<string | null>): string | null {
  return parts.filter(Boolean).join(" ") || null;
}

function labeledValue(doc: Document, selector: string, label: RegExp): string | null {
  for (const row of Array.from(doc.querySelectorAll(selector)).slice(0, 80)) {
    const rowText = clean(row.textContent);
    if (!rowText || !label.test(rowText)) continue;
    const cells = row.querySelectorAll("th, td");
    const last = cells[cells.length - 1];
    if (cells.length >= 2 && last) return clean(last.textContent)?.slice(0, 200) ?? null;
    const colon = rowText.indexOf(":");
    return clean(colon >= 0 ? rowText.slice(colon + 1) : rowText)?.slice(0, 200) ?? null;
  }
  return null;
}

function imageUrl(img: HTMLImageElement | null | undefined): string | null {
  if (!img) return null;
  const candidates = [img.currentSrc, img.src, img.getAttribute("data-src"), img.getAttribute("data-old-hires")];
  for (const candidate of candidates) {
    if (candidate && /^https?:/.test(candidate)) return candidate;
  }
  return null;
}

function imageSrc(doc: Document, selector: string): string | null {
  return imageUrl(doc.querySelector<HTMLImageElement>(selector));
}
