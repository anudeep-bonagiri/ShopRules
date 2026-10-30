// Stills of the HUD and the popup for docs/design/shots/ext-*.png.
//   node extension/test/shots.mts
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const shots = join(root, "docs", "design", "shots");

function loadPlaywright(): typeof import("playwright") {
  const req = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_PATH, join(root, "node_modules/playwright")].filter(Boolean) as string[];
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
  throw new Error("Playwright not found");
}

async function main(): Promise<void> {
  mkdirSync(shots, { recursive: true });
  const bundle = (await esbuild.build({ entryPoints: [join(here, "hud-entry.ts")], bundle: true, write: false, format: "iife", platform: "browser", target: ["chrome116"] })).outputFiles[0]!.text;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const html = readFileSync(join(here, "fixtures", "amazon.html"), "utf8");
  await page.route("**/*", async (route) => {
    const u = route.request().url();
    if (u === "https://www.amazon.com/dp/B0CXK7L9QZ") return route.fulfill({ status: 200, contentType: "text/html", body: html });
    return route.fulfill({ status: 200, contentType: "text/plain", body: "" });
  });
  await page.goto("https://www.amazon.com/dp/B0CXK7L9QZ");
  await page.addScriptTag({ content: bundle });

  const open = async (mode: string, name: string, after?: () => Promise<void>) => {
    await page.evaluate((m) => window.__srHud.open(m as "watched"), mode);
    await page.waitForTimeout(600);
    if (after) await after();
    await page.screenshot({ path: join(shots, name), fullPage: false });
    await page.evaluate(() => window.__srHud.panel.close());
    await page.waitForTimeout(300);
  };

  await open("unwatched", "ext-01-hud-unwatched.png");
  await open("watched", "ext-02-hud-watched.png");
  await open("watched", "ext-03-hud-compare.png", async () => {
    const host = page.locator("#shop-rules-host");
    await host.locator('[data-action="compare"]').click();
    await page.waitForTimeout(900);
    await host.locator(".sr-body").evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(200);
  });
  await open("watched", "ext-04-hud-checking.png", async () => {
    const host = page.locator("#shop-rules-host");
    await host.locator('[data-action="check"]').click();
    await page.waitForTimeout(5200);
  });
  await open("price", "ext-05-hud-price-change.png");

  // Popup with chrome.* stubbed.
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 760 });
  await popup.addInitScript(() => {
    const products = [
      { id: "p1", title: "USB-C Rechargeable LED Desk Lamp with Lithium Battery, 3 Color Modes, Foldable", price: 29.99, currency: "USD", image_url: null, created_at: "2026-09-28T00:00:00Z", open_alerts: 1, profile: { price: 31.99 } },
      { id: "p2", title: "Wooden Rainbow Stacker Toy, Montessori Stacking Blocks", price: 34, currency: "USD", image_url: null, created_at: "2026-09-28T00:00:00Z", open_alerts: 0, profile: { price: 34 } },
      { id: "p3", title: "Organic Cotton Oversized Tee, Garment Dyed, Unisex", price: 45, currency: "USD", image_url: null, created_at: "2026-09-28T00:00:00Z", open_alerts: 0, profile: { price: 42 } },
    ];
    const responses: Record<string, unknown> = {
      account: { account: { id: "acct12345678", token: "sr_live_x", telegram_configured: false, settings: {} } },
      products: { products },
      alerts: { alerts: [{ id: "a" }] },
      lookup: { watched: true, product: products[0], marketplace: "amazon", families_preview: [] },
      poll: { count: 1 },
    };
    (window as unknown as { chrome: unknown }).chrome = {
      storage: { sync: { get: async () => ({ baseUrl: "https://shop-rules.vercel.app", token: "sr_live_x" }), set: async () => undefined } },
      runtime: { sendMessage: async (m: { type: string }) => ({ ok: true, data: responses[m.type] ?? {} }) },
      tabs: { query: async () => [{ id: 1, url: "https://www.amazon.com/dp/B0CXK7L9QZ" }] },
      permissions: { contains: async () => true },
      scripting: {},
    };
  });
  await popup.goto(pathToFileURL(join(root, "extension", "dist", "popup.html")).href);
  await popup.waitForTimeout(600);
  await popup.screenshot({ path: join(shots, "ext-06-popup.png"), fullPage: true });

  await browser.close();
  console.log("wrote ext-01..06 to docs/design/shots/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
