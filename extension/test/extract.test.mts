// Field extraction against fixture pages that mirror Amazon, Etsy, Shopify, and
// a custom-domain Shopify store (with the public .json endpoint mocked). Runs
// the real extract.ts in Chromium through the pre-installed Playwright.
//   node --test extension/test/extract.test.mts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

function loadPlaywright(): typeof import("playwright") {
  const req = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_PATH, resolve(here, "../../node_modules/playwright")].filter(Boolean) as string[];
  const npx = join(homedir(), ".npm", "_npx");
  if (existsSync(npx)) for (const d of readdirSync(npx)) candidates.push(join(npx, d, "node_modules", "playwright"));
  let first: typeof import("playwright") | null = null;
  for (const c of candidates) {
    if (!existsSync(join(c, "package.json"))) continue;
    const pw = req(c) as typeof import("playwright");
    first ??= pw;
    try {
      if (existsSync(pw.chromium.executablePath())) return pw;
    } catch {
      // keep looking
    }
  }
  if (first) return first;
  throw new Error("Playwright not found; run npx -y playwright install chromium or set PLAYWRIGHT_PATH");
}

let browser: import("playwright").Browser;
let bundle = "";

before(async () => {
  const out = await esbuild.build({ entryPoints: [join(here, "extract-entry.ts")], bundle: true, write: false, format: "iife", platform: "browser", target: ["chrome116"] });
  bundle = out.outputFiles[0]!.text;
  browser = await loadPlaywright().chromium.launch();
});

after(async () => {
  await browser?.close();
});

type Extracted = { url: string; title: string | null; price: number | null; currency: string | null; description: string | null; materials: string[] | null; image: string | null; confidence?: Record<string, string>; vendor?: string | null; product_type?: string | null; tags?: string[] | null };

async function openFixture(name: string, url: string, jsonMock?: unknown) {
  const page = await browser.newPage();
  const html = readFileSync(join(fixtures, name), "utf8");
  await page.route("**/*", async (route) => {
    const req = route.request();
    const u = req.url();
    if (jsonMock && /\/products\/[^/?#]+\.json$/.test(u)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(jsonMock) });
      return;
    }
    if (u === url) {
      await route.fulfill({ status: 200, contentType: "text/html", body: html });
      return;
    }
    // Images, stylesheets, and everything else from the marketplace stay offline.
    await route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
  await page.goto(url);
  await page.addScriptTag({ content: bundle });
  return page;
}

test("Amazon product page: selectors give title, price, materials, image", async () => {
  const page = await openFixture("amazon.html", "https://www.amazon.com/dp/B0CXK7L9QZ");
  const r = (await page.evaluate(() => {
    const sr = window.__sr as Record<string, (...a: unknown[]) => unknown>;
    const m = sr.detectMarketplace!() as string;
    return { m, productPage: sr.isProductPage!(m), p: sr.extractPageProduct!(m) as Extracted };
  })) as { m: string; productPage: boolean; p: Extracted };
  assert.equal(r.m, "amazon");
  assert.equal(r.productPage, true);
  assert.equal(r.p.url, "https://www.amazon.com/dp/B0CXK7L9QZ");
  assert.match(r.p.title ?? "", /LED Desk Lamp/);
  assert.equal(r.p.price, 29.99);
  assert.equal(r.p.currency, "USD");
  assert.deepEqual(r.p.materials, ["aluminum alloy", "abs plastic"]);
  assert.equal(r.p.image, "https://m.media-amazon.com/images/I/lamp.jpg");
  assert.equal(r.p.confidence?.price, "selectors");
  await page.close();
});

test("Etsy listing: JSON-LD wins, cards on the same page resolve to their own listing", async () => {
  const page = await openFixture("etsy.html", "https://www.etsy.com/listing/1458123456/wooden-rainbow-stacker-toy-montessori");
  const r = (await page.evaluate(() => {
    const sr = window.__sr as Record<string, (...a: unknown[]) => unknown>;
    const m = sr.detectMarketplace!() as string;
    const p = sr.extractPageProduct!(m) as Extracted;
    const h3 = document.querySelector('.v2-listing-card[data-listing-id="333"] h3');
    const cardEl = sr.findProductCardElement!(h3, m) as Element | null;
    const card = cardEl ? sr.productFromCard!(cardEl, m) : null;
    return { m, p, card };
  })) as { m: string; p: Extracted; card: { url: string; title: string | null; price: number | null; currency: string | null } | null };
  assert.equal(r.m, "etsy");
  assert.equal(r.p.price, 34);
  assert.equal(r.p.currency, "USD");
  assert.equal(r.p.confidence?.price, "json_ld");
  assert.deepEqual(r.p.materials, ["beech wood", "water-based paint"]);
  assert.equal(r.card?.url, "https://www.etsy.com/listing/333/felt-ball-garland");
  assert.equal(r.card?.price, 24.5);
  assert.match(r.card?.title ?? "", /Felt Ball Garland/);
  await page.close();
});

test("Etsy search card: the overlay button is not the title, the inner listing block grows to the whole card, the sale price wins", async () => {
  const page = await openFixture("etsy.html", "https://www.etsy.com/search?q=ceramic+mug");
  const r = (await page.evaluate(() => {
    const sr = window.__sr as Record<string, (...a: unknown[]) => unknown>;
    const m = sr.detectMarketplace!() as string;
    const button = document.querySelector(".listing-card-overlay button");
    const fromButton = sr.findProductCardElement!(button, m) as Element | null;
    const img = document.querySelector('img[alt="Hand painted ceramic mug"]');
    const fromImage = sr.findProductCardElement!(img, m) as Element | null;
    const card = fromImage ? sr.productFromCard!(fromImage, m) : null;
    return { same: fromButton === fromImage, card };
  })) as { same: boolean; card: { url: string; title: string | null; price: number | null; currency: string | null } | null };
  assert.equal(r.same, true);
  assert.equal(r.card?.url, "https://www.etsy.com/listing/444/hand-painted-ceramic-mug");
  assert.equal(r.card?.title, "Hand Painted Ceramic Mug, Stoneware Coffee Cup");
  assert.equal(r.card?.price, 35);
  assert.equal(r.card?.currency, "USD");
  await page.close();
});

test("Amazon search results: a sponsored card resolves by its ASIN even with click-through and color links inside", async () => {
  const page = await openFixture("amazon-search.html", "https://www.amazon.com/s?k=led+desk+lamp");
  const r = (await page.evaluate(() => {
    const sr = window.__sr as Record<string, (...a: unknown[]) => unknown>;
    const m = sr.detectMarketplace!() as string;
    const isProduct = sr.isProductPage!(m) as boolean;
    const span = document.querySelector('[data-asin="B0CXK7L9QZ"] .a-text-normal');
    const cardEl = sr.findProductCardElement!(span, m) as Element | null;
    const card = cardEl ? sr.productFromCard!(cardEl, m) : null;
    const second = sr.findProductCardElement!(document.querySelector('[data-asin="B07XYZ123A"] img'), m) as Element | null;
    const sponsoredUrl = sr.canonicalProductUrl!("https://www.amazon.com/sspa/click?ie=UTF8&spc=abc&url=%2FLumenex%2Fdp%2FB0CXK7L9QZ%2Fref%3Dsr_1_1_sspa", m) as string | null;
    return { m, isProduct, card, secondUrl: second ? (sr.productFromCard!(second, m) as { url: string } | null)?.url : null, sponsoredUrl };
  })) as { m: string; isProduct: boolean; card: { url: string; title: string | null; price: number | null } | null; secondUrl: string | null; sponsoredUrl: string | null };
  assert.equal(r.m, "amazon");
  assert.equal(r.isProduct, false);
  assert.equal(r.card?.url, "https://www.amazon.com/dp/B0CXK7L9QZ");
  assert.match(r.card?.title ?? "", /Lumenex USB-C Rechargeable LED Desk Lamp/);
  assert.equal(r.card?.price, 29.99);
  assert.equal(r.secondUrl, "https://www.amazon.com/dp/B07XYZ123A");
  assert.equal(r.sponsoredUrl, "https://www.amazon.com/dp/B0CXK7L9QZ");
  await page.close();
});

test("myshopify store: Open Graph price and the Dawn selectors agree", async () => {
  const page = await openFixture("shopify.html", "https://sunday-studio-goods.myshopify.com/products/organic-cotton-oversized-tee");
  const r = (await page.evaluate(() => {
    const sr = window.__sr as Record<string, (...a: unknown[]) => unknown>;
    const m = sr.detectMarketplace!() as string;
    return { m, p: sr.extractPageProduct!(m) as Extracted };
  })) as { m: string; p: Extracted };
  assert.equal(r.m, "shopify");
  assert.equal(r.p.price, 42);
  assert.equal(r.p.currency, "USD");
  assert.equal(r.p.confidence?.price, "open_graph");
  assert.deepEqual(r.p.materials, ["organic cotton"]);
  await page.close();
});

test("custom-domain Shopify: detected without myshopify in the host, .json preferred over the DOM", async () => {
  const mock = JSON.parse(readFileSync(join(fixtures, "shopify-custom.json"), "utf8"));
  const page = await openFixture("shopify-custom.html", "https://www.allbirds.com/products/mens-wool-runners", mock);
  const r = (await page.evaluate(async () => {
    const sr = window.__sr as Record<string, (...a: unknown[]) => unknown>;
    const m = sr.detectMarketplace!() as string;
    const dom = sr.extractPageProduct!(m) as Extracted;
    const full = (await (sr.extractPageProductAsync!(m) as Promise<Extracted>)) as Extracted;
    return { m, looks: sr.looksLikeShopify!(document, location), dom, full };
  })) as { m: string; looks: boolean; dom: Extracted; full: Extracted };
  assert.equal(r.m, "shopify");
  assert.equal(r.looks, true);
  assert.equal(r.dom.price, 110, "the DOM shows the displayed price");
  assert.equal(r.full.price, 100, "the .json gives the exact variant price");
  assert.equal(r.full.confidence?.price, "api");
  assert.equal(r.full.vendor, "Allbirds");
  assert.equal(r.full.product_type, "Shoes");
  assert.deepEqual(r.full.tags, ["mens", "runners", "wool"]);
  assert.ok(r.full.materials?.includes("merino wool"));
  assert.equal(r.full.url, "https://www.allbirds.com/products/mens-wool-runners");
  await page.close();
});
