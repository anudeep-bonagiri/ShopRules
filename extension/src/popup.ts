// Toolbar popup: connection status, the watchlist with price deltas and open
// alert counts, site access for custom Shopify domains, and an Advanced
// disclosure (backend URL, token, force full recheck).
import { send } from "./bridge";
import type { AccountResponse, AlertsResponse, CheckResponse, HealthResponse, LookupResponse, Product, ProductsResponse, Settings } from "./types";

const DEFAULT_BASE_URL = "https://shop-rules.vercel.app";
const BUILT_IN_HOSTS = /(^|\.)(amazon\.(com|co\.uk|ca|de)|etsy\.com|myshopify\.com)$/i;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

const baseUrlInput = el<HTMLInputElement>("base-url");
const tokenInput = el<HTMLInputElement>("token");
const status = el<HTMLSpanElement>("status");
const connectionLine = el<HTMLParagraphElement>("connection-line");
const connectActions = el<HTMLDivElement>("connect-actions");
const connectLink = el<HTMLAnchorElement>("connect-link");
const settingsLink = el<HTMLAnchorElement>("settings-link");
const testResult = el<HTMLParagraphElement>("test-result");
const watchlist = el<HTMLUListElement>("watchlist");
const watchlistLine = el<HTMLParagraphElement>("watchlist-line");
const watchCount = el<HTMLSpanElement>("watch-count");
const openApp = el<HTMLAnchorElement>("open-app");
const siteLine = el<HTMLParagraphElement>("site-line");
const grantButton = el<HTMLButtonElement>("grant");
const grantResult = el<HTMLParagraphElement>("grant-result");
const forceButton = el<HTMLButtonElement>("force");
const forceResult = el<HTMLParagraphElement>("force-result");

type Tone = "ok" | "error" | "info";

function showResult(node: HTMLElement, tone: Tone, message: string): void {
  node.textContent = message;
  node.className = `result result--${tone}`;
  node.hidden = false;
}

function setStatus(tone: "success" | "critical" | "warning" | "neutral", label: string): void {
  status.className = `badge badge--${tone}`;
  status.textContent = label;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BASE_URL;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get({ baseUrl: DEFAULT_BASE_URL, token: "" });
  return { baseUrl: normalizeBaseUrl(String(stored.baseUrl ?? DEFAULT_BASE_URL)), token: String(stored.token ?? "").trim() };
}

function money(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const code = currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

function workspaceName(data: AccountResponse): string {
  const a = data.account;
  const name = (a as { name?: string | null }).name;
  return name && name.trim() ? name.trim() : `workspace ${a.id.slice(0, 8)}`;
}

// Connection

async function refreshStatus(): Promise<boolean> {
  const { token, baseUrl } = await loadSettings();
  settingsLink.href = `${baseUrl}/settings`;
  connectLink.href = `${baseUrl}/settings`;
  openApp.href = `${baseUrl}/`;
  if (!token) {
    setStatus("neutral", "Not connected");
    connectionLine.textContent = "Connect from the Shop Rules Settings page with one click, or paste a token under Advanced.";
    connectActions.hidden = false;
    return false;
  }
  const result = await send<AccountResponse>({ type: "account" });
  if (result.ok) {
    setStatus("success", "Connected");
    connectionLine.textContent = `Connected to ${workspaceName(result.data)} at ${baseUrl.replace(/^https?:\/\//, "")}.`;
    connectActions.hidden = true;
    return true;
  }
  connectActions.hidden = false;
  if (result.code === "auth") {
    setStatus("critical", "Token rejected");
    connectionLine.textContent = "The saved token was rejected. Reconnect from the Settings page or paste a fresh token under Advanced.";
  } else if (result.code === "network") {
    setStatus("critical", "Unreachable");
    connectionLine.textContent = result.error;
  } else {
    setStatus("warning", "Error");
    connectionLine.textContent = result.error;
  }
  return false;
}

async function save(): Promise<void> {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  const token = tokenInput.value.trim();
  await chrome.storage.sync.set({ baseUrl, token });
  baseUrlInput.value = baseUrl;
  showResult(testResult, "info", "Saved.");
  const ok = await refreshStatus();
  await refreshWatchlist(ok);
}

async function testConnection(): Promise<void> {
  showResult(testResult, "info", "Testing...");
  const result = await send<HealthResponse>({ type: "health" });
  if (!result.ok) {
    showResult(testResult, "error", result.error);
    setStatus("critical", "Unreachable");
    return;
  }
  const h = result.data;
  const parts = [`Shop Rules ${h.version} is reachable.`, `Tavily: ${h.tavily_mode}.`, `Nemotron: ${h.nemotron_configured ? "configured" : "not configured"}.`];
  if (!tokenInput.value.trim()) {
    parts.push("Add your account token to see the watchlist.");
    showResult(testResult, "info", parts.join(" "));
    setStatus("warning", "No token");
    return;
  }
  const account = await send<AccountResponse>({ type: "account" });
  if (!account.ok) {
    showResult(testResult, "error", account.code === "auth" ? "Token rejected. Copy a fresh token from the Settings page and reconnect." : account.error);
    setStatus("critical", account.code === "auth" ? "Token rejected" : "Error");
    return;
  }
  parts.unshift(`Connected to ${workspaceName(account.data)}.`);
  showResult(testResult, "ok", parts.join(" "));
  setStatus("success", "Connected");
}

// Watchlist

function deltaFor(p: Product): { text: string; cls: string } | null {
  const first = p.profile?.price;
  const now = p.price;
  if (typeof first !== "number" || typeof now !== "number" || first <= 0 || now <= 0) return null;
  const pct = ((now - first) / first) * 100;
  if (Math.abs(pct) < 0.05) return { text: "= since added", cls: "" };
  const up = pct > 0;
  return { text: `${up ? "↑" : "↓"} ${Math.abs(pct).toFixed(1)}% since added`, cls: up ? "up" : "down" };
}

function renderWatchlist(products: Product[], baseUrl: string): void {
  watchlist.textContent = "";
  const sorted = [...products].sort((a, b) => (b.open_alerts ?? 0) - (a.open_alerts ?? 0) || b.created_at.localeCompare(a.created_at));
  for (const p of sorted.slice(0, 8)) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = "item";
    a.href = `${baseUrl}/products/${encodeURIComponent(p.id)}`;
    a.target = "_blank";
    a.rel = "noopener";
    if (p.image_url && /^https?:\/\//.test(p.image_url)) {
      const img = document.createElement("img");
      img.className = "item__thumb";
      img.src = p.image_url;
      img.alt = "";
      a.appendChild(img);
    } else {
      const ph = document.createElement("span");
      ph.className = "item__thumb";
      a.appendChild(ph);
    }
    const body = document.createElement("span");
    body.className = "item__body";
    const title = document.createElement("span");
    title.className = "item__title";
    title.textContent = p.title;
    title.title = p.title;
    const meta = document.createElement("span");
    meta.className = "item__meta";
    const price = document.createElement("span");
    price.className = "item__price";
    price.textContent = money(p.price, p.currency) || "no price";
    meta.appendChild(price);
    const d = deltaFor(p);
    if (d) {
      const delta = document.createElement("span");
      delta.className = d.cls;
      delta.textContent = d.text;
      meta.appendChild(delta);
    }
    const open = p.open_alerts ?? 0;
    const alerts = document.createElement("span");
    alerts.className = `badge item__alerts ${open > 0 ? "badge--critical" : "badge--success"}`;
    alerts.textContent = open > 0 ? `${open} alert${open === 1 ? "" : "s"}` : "clear";
    meta.appendChild(alerts);
    body.append(title, meta);
    a.appendChild(body);
    li.appendChild(a);
    watchlist.appendChild(li);
  }
  watchCount.textContent = products.length ? `${products.length} product${products.length === 1 ? "" : "s"}` : "";
}

async function refreshWatchlist(connected: boolean): Promise<void> {
  const { baseUrl } = await loadSettings();
  openApp.href = `${baseUrl}/`;
  if (!connected) {
    watchlist.textContent = "";
    watchCount.textContent = "";
    watchlistLine.hidden = false;
    watchlistLine.textContent = "Connect to see the products you watch.";
    return;
  }
  const [products, alerts] = await Promise.all([send<ProductsResponse>({ type: "products" }), send<AlertsResponse>({ type: "alerts" })]);
  if (!products.ok) {
    watchlistLine.hidden = false;
    watchlistLine.textContent = products.error;
    return;
  }
  const list = products.data.products;
  if (list.length === 0) {
    watchlist.textContent = "";
    watchlistLine.hidden = false;
    watchlistLine.textContent = "Nothing watched yet. Open a listing and press Alt+Shift+S.";
    return;
  }
  renderWatchlist(list, baseUrl);
  const open = alerts.ok ? alerts.data.alerts.length : list.reduce((s, p) => s + (p.open_alerts ?? 0), 0);
  watchlistLine.hidden = false;
  watchlistLine.textContent = open === 0 ? "No open alerts." : `${open} open alert${open === 1 ? "" : "s"} across your watchlist.`;
  void send({ type: "poll" });
}

// Site access for Shopify stores on custom domains, and the force recheck target

interface SiteTarget {
  tabId: number;
  origin: string;
  hostname: string;
  pattern: string;
  url: string;
}

async function currentSite(): Promise<SiteTarget | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return null;
  let url: URL;
  try {
    url = new URL(tab.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return { tabId: tab.id, origin: url.origin, hostname: url.hostname, pattern: `${url.origin}/*`, url: tab.url };
}

async function injectPanel(site: SiteTarget): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId: site.tabId }, files: ["content.js"] });
  const id = `shop-rules-${site.hostname}`;
  const script: chrome.scripting.RegisteredContentScript = { id, matches: [site.pattern], js: ["content.js"], runAt: "document_idle", persistAcrossSessions: true };
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}

async function setupSiteCard(site: SiteTarget | null): Promise<void> {
  if (!site) {
    siteLine.textContent = "Open a store page to grant access.";
    return;
  }
  if (BUILT_IN_HOSTS.test(site.hostname)) {
    siteLine.textContent = `${site.hostname} is supported out of the box.`;
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [site.pattern] });
  siteLine.textContent = granted ? `${site.hostname} has access. Use this to inject the panel without reloading.` : `Grant access so the panel works on ${site.hostname} (for Shopify stores on their own domain).`;
  grantButton.textContent = granted ? "Inject panel on this page" : "Grant access to this site";
  grantButton.disabled = false;
  grantButton.addEventListener("click", () => {
    void chrome.permissions
      .request({ origins: [site.pattern] })
      .then(async (ok) => {
        if (!ok) {
          showResult(grantResult, "error", "Access was not granted.");
          return;
        }
        await injectPanel(site);
        grantButton.textContent = "Inject panel on this page";
        showResult(grantResult, "ok", `Shop Rules is active on ${site.hostname}. Hover a product and press Alt+Shift+S.`);
      })
      .catch((err: unknown) => showResult(grantResult, "error", err instanceof Error ? err.message : String(err)));
  });
}

async function setupForce(site: SiteTarget | null, connected: boolean): Promise<void> {
  if (!site || !connected) {
    forceButton.disabled = true;
    forceButton.textContent = connected ? "Force full recheck (open a watched listing)" : "Force full recheck (connect first)";
    return;
  }
  const lookup = await send<LookupResponse>({ type: "lookup", url: site.url });
  if (!lookup.ok || !lookup.data.watched || !lookup.data.product) {
    forceButton.disabled = true;
    forceButton.textContent = "Force full recheck (this page is not a watched product)";
    return;
  }
  const product = lookup.data.product;
  forceButton.disabled = false;
  forceButton.textContent = `Force full recheck: ${product.title.slice(0, 40)}${product.title.length > 40 ? "..." : ""}`;
  forceButton.addEventListener("click", () => {
    forceButton.disabled = true;
    showResult(forceResult, "info", "Rechecking every rule, this takes up to two minutes...");
    void send<CheckResponse>({ type: "check", id: product.id, scope: "all", force: true }).then((r) => {
      forceButton.disabled = false;
      if (!r.ok) {
        showResult(forceResult, "error", r.error);
        return;
      }
      const found = r.data.alerts?.length ?? 0;
      showResult(forceResult, "ok", `Checked ${r.data.checked} rule${r.data.checked === 1 ? "" : "s"}, ${found} new alert${found === 1 ? "" : "s"}.`);
      void refreshWatchlist(true);
    });
  });
}

// Boot

async function init(): Promise<void> {
  const settings = await loadSettings();
  baseUrlInput.value = settings.baseUrl;
  tokenInput.value = settings.token;
  el<HTMLButtonElement>("save").addEventListener("click", () => void save());
  el<HTMLButtonElement>("test").addEventListener("click", () => void testConnection());
  const [connected, site] = await Promise.all([refreshStatus(), currentSite()]);
  await Promise.all([refreshWatchlist(connected), setupSiteCard(site), setupForce(site, connected)]);
}

void init();
