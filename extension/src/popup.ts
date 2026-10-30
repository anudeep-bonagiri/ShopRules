// Toolbar popup: settings, connection test, alert count, and site access.
import { send } from "./bridge";
import type { AlertsResponse, HealthResponse, Settings } from "./types";

const DEFAULT_BASE_URL = "https://shop-rules.vercel.app";
const BUILT_IN_HOSTS = /(^|\.)(amazon\.com|etsy\.com|myshopify\.com)$/i;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

const baseUrlInput = el<HTMLInputElement>("base-url");
const tokenInput = el<HTMLInputElement>("token");
const status = el<HTMLSpanElement>("status");
const testResult = el<HTMLParagraphElement>("test-result");
const alertsLine = el<HTMLParagraphElement>("alerts-line");
const alertsLink = el<HTMLAnchorElement>("alerts-link");
const siteLine = el<HTMLParagraphElement>("site-line");
const grantButton = el<HTMLButtonElement>("grant");
const grantResult = el<HTMLParagraphElement>("grant-result");

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
  return { baseUrl: String(stored.baseUrl ?? DEFAULT_BASE_URL), token: String(stored.token ?? "").trim() };
}

// Settings

async function save(): Promise<void> {
  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  const token = tokenInput.value.trim();
  await chrome.storage.sync.set({ baseUrl, token });
  baseUrlInput.value = baseUrl;
  showResult(testResult, "info", "Saved.");
  await Promise.all([refreshStatus(), refreshAlerts()]);
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
  const token = tokenInput.value.trim();
  const parts = [
    `Connected to Shop Rules ${h.version}.`,
    `Tavily: ${h.tavily_mode}.`,
    `Nemotron: ${h.nemotron_configured ? "configured" : "not configured"}.`,
  ];
  if (!token) parts.push("Add your account token to see alerts.");
  showResult(testResult, "ok", parts.join(" "));
  setStatus(token ? "success" : "warning", token ? "Connected" : "No token");
}

async function refreshStatus(): Promise<void> {
  const { token } = await loadSettings();
  if (!token) {
    setStatus("neutral", "Not connected");
    return;
  }
  const result = await send<HealthResponse>({ type: "health" });
  setStatus(result.ok ? "success" : "critical", result.ok ? "Connected" : "Unreachable");
}

// Alerts

async function refreshAlerts(): Promise<void> {
  const { baseUrl, token } = await loadSettings();
  alertsLink.href = `${normalizeBaseUrl(baseUrl)}/alerts`;
  if (!token) {
    alertsLine.textContent = "Add your account token to see open alerts.";
    return;
  }
  const result = await send<AlertsResponse>({ type: "alerts" });
  if (!result.ok) {
    alertsLine.textContent = result.error;
    return;
  }
  const count = result.data.alerts.length;
  alertsLine.textContent = count === 0 ? "No open alerts." : `${count} open alert${count === 1 ? "" : "s"}.`;
  void send({ type: "poll" });
}

// Site access for Shopify stores on custom domains

interface SiteTarget {
  tabId: number;
  origin: string;
  hostname: string;
  pattern: string;
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
  if (url.protocol !== "https:") return null;
  return { tabId: tab.id, origin: url.origin, hostname: url.hostname, pattern: `${url.origin}/*` };
}

async function injectPanel(site: SiteTarget): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId: site.tabId }, files: ["content.js"] });
  const id = `shop-rules-${site.hostname}`;
  const script: chrome.scripting.RegisteredContentScript = {
    id,
    matches: [site.pattern],
    js: ["content.js"],
    runAt: "document_idle",
    persistAcrossSessions: true,
  };
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}

async function setupSiteCard(): Promise<void> {
  const site = await currentSite();
  if (!site) {
    siteLine.textContent = "Open a store page over https to grant access.";
    return;
  }
  if (BUILT_IN_HOSTS.test(site.hostname)) {
    siteLine.textContent = `${site.hostname} is supported out of the box.`;
    return;
  }
  const granted = await chrome.permissions.contains({ origins: [site.pattern] });
  siteLine.textContent = granted
    ? `${site.hostname} has access. Use this to inject the panel without reloading.`
    : `Grant access so the panel works on ${site.hostname} (for Shopify stores on their own domain).`;
  grantButton.textContent = granted ? "Inject panel on this page" : "Grant access to this site";
  grantButton.disabled = false;

  grantButton.addEventListener("click", () => {
    // permissions.request must run inside the click, before any other await.
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
      .catch((err: unknown) => {
        showResult(grantResult, "error", err instanceof Error ? err.message : String(err));
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
  await Promise.all([refreshStatus(), refreshAlerts(), setupSiteCard()]);
}

void init();
