// Smoke test: starts next dev on :3100 with apps/web/.env.local, walks every
// page, opens the first product, checks the empty state is not shown when
// products exist, fails on console errors, and saves full-page screenshots to
// docs/design/shots/. Usage: npm run smoke [-- --keep] [--base http://host:port]
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const shots = join(root, "docs", "design", "shots");
const args = process.argv.slice(2);
const baseArg = args.includes("--base") ? args[args.indexOf("--base") + 1] : null;
const PORT = 3100;
const BASE = baseArg ?? `http://localhost:${PORT}`;

// Playwright is pre-installed but not a dependency of this repo: find it in the
// local node_modules, the global root, or the npx cache (set PLAYWRIGHT_PATH to pin it).
function loadPlaywright(): typeof import("playwright") {
  const req = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_PATH, join(root, "node_modules", "playwright")].filter(Boolean) as string[];
  try {
    candidates.push(join(require("node:child_process").execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"));
  } catch {
    // no global npm root
  }
  const npx = join(homedir(), ".npm", "_npx");
  if (existsSync(npx)) for (const d of readdirSync(npx)) candidates.push(join(npx, d, "node_modules", "playwright"));
  let firstFound: typeof import("playwright") | null = null;
  for (const c of candidates) {
    if (!existsSync(join(c, "package.json"))) continue;
    const pw = req(c) as typeof import("playwright");
    firstFound ??= pw;
    // Prefer a copy whose Chromium build is actually downloaded.
    try {
      if (existsSync(pw.chromium.executablePath())) return pw;
    } catch {
      // keep looking
    }
  }
  if (firstFound) return firstFound; // will print Playwright's own "run npx playwright install" hint
  throw new Error("Playwright not found. Run: npx -y playwright install chromium, or set PLAYWRIGHT_PATH to a playwright package directory.");
}

function readEnvLocal(): Record<string, string> {
  const file = join(root, "apps", "web", ".env.local");
  const out: Record<string, string> = {};
  if (!existsSync(file)) {
    console.warn("smoke: apps/web/.env.local is missing; running in offline demo mode (local file store, canned Nemotron and Tavily answers from the eval fixtures).");
    return out;
  }
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function waitFor(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`${url} did not come up within ${ms} ms`);
}

let server: ChildProcess | null = null;
function stopServer(): void {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, "SIGTERM"); // whole process group: npx -> next -> workers
  } catch {
    server.kill("SIGTERM");
  }
  server = null;
}
process.on("exit", stopServer);
process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

async function portBusy(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/api/health`);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  mkdirSync(shots, { recursive: true });
  const { chromium } = loadPlaywright();
  if (!baseArg) {
    if (await portBusy(PORT)) throw new Error(`Port ${PORT} is already in use. Stop that server (lsof -ti :${PORT} | xargs kill) or pass --base to test it instead.`);
    const env = { ...process.env, ...readEnvLocal(), PORT: String(PORT), NEXT_TELEMETRY_DISABLED: "1" };
    server = spawn("npx", ["next", "dev", "-p", String(PORT)], { cwd: join(root, "apps", "web"), env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    server.stdout?.on("data", (d) => process.env.SMOKE_VERBOSE && process.stdout.write(d));
    server.stderr?.on("data", (d) => process.stderr.write(d));
    await waitFor(`${BASE}/api/health`, 90_000);
  }

  const failures: string[] = [];
  const consoleErrors: string[] = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Next dev overlay noise and favicon 404s are not product bugs.
    if (/favicon|Download the React DevTools|hydration/i.test(text)) return;
    consoleErrors.push(text);
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  const shot = async (name: string) => {
    await page.waitForSelector(".sr-skel", { state: "detached", timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  };

  // 1. Watchlist, seed the demo shop if empty.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const emptyWatchlist = await page.getByText("Nothing to watch yet").count();
  const storageDown = await page.getByText(/Storage is not configured|not connected to a workspace|unreachable/i).count();
  if (emptyWatchlist > 0 && storageDown === 0) {
    console.log("smoke: watchlist is empty, loading the demo shop");
    await page.getByRole("button", { name: "Load demo shop" }).first().click();
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !/Loading/.test(document.body.innerText), null, { timeout: 180_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  }
  await shot("01-watchlist");

  const health = (await (await fetch(`${BASE}/api/health`)).json()) as { storage_configured?: boolean };
  const products = health.storage_configured
    ? ((await (await fetch(`${BASE}/api/products`, { headers: { cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } })).json()) as { products?: unknown[] }).products ?? []
    : [];
  if (products.length > 0 && (await page.getByText("Nothing to watch yet").count()) > 0) failures.push("Watchlist shows 'Nothing to watch yet' although products exist");

  // 2. Every nav page.
  const pages: Array<[string, string]> = [
    ["/products", "02-inspector"],
    ["/alerts", "03-alerts"],
    ["/rules", "04-rules"],
    ["/receipt", "05-receipt"],
    ["/settings", "06-settings"],
  ];
  for (const [path, name] of pages) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await shot(name);
    if (!health.storage_configured) continue;
    if (products.length > 0 && path === "/products" && (await page.getByText("No products yet").count()) > 0) failures.push("Inspector shows 'No products yet' although products exist");
  }

  // 3. First product and its first alert, when any.
  if (products.length > 0) {
    await page.goto(`${BASE}/products`, { waitUntil: "networkidle" });
    const first = page.locator("a.sr-prow").first();
    if ((await first.count()) === 0) failures.push("Inspector list has no product rows");
    else {
      await first.click();
      await page.waitForURL(/\/products\/[^/]+$/);
      await page.waitForLoadState("networkidle");
      await shot("07-product");
      const alertLink = page.locator('a[href^="/alerts/"]').first();
      if ((await alertLink.count()) > 0) {
        await alertLink.click();
        await page.waitForURL(/\/alerts\/[^/]+$/);
        await page.waitForLoadState("networkidle");
        await shot("08-alert");
      }
    }
  }

  // 4. Phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shot("09-watchlist-390");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 2) failures.push(`Horizontal overflow of ${overflow}px at 390 wide`);

  await browser.close();
  if (args.includes("--keep")) server = null; // leave it running for a manual look
  else stopServer();

  const relevantErrors = health.storage_configured ? consoleErrors : consoleErrors.filter((e) => !/status of 500/.test(e));
  if (!health.storage_configured) console.warn("smoke: storage is not configured, so API 500s are expected and not counted; add apps/web/.env.local for a full run.");
  if (relevantErrors.length) failures.push(`Console errors:\n  ${Array.from(new Set(relevantErrors)).slice(0, 10).join("\n  ")}`);
  console.log(`smoke: ${pages.length + 2} pages visited, ${products.length} products, screenshots in docs/design/shots/`);
  if (failures.length) {
    console.error(`smoke: FAILED\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("smoke: OK");
  process.exit(0);
}

main().catch((err) => {
  console.error("smoke: crashed", err);
  process.exit(1);
});
