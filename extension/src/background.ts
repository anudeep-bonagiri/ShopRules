// Service worker: owns the token, calls the Shop Rules API, polls for new
// alerts, keeps the badge in sync, and relays the keyboard command to tabs.
import type {
  Alert,
  AlertsResponse,
  ApiErrorCode,
  ApiFailure,
  BgRequest,
  BgResult,
  Settings,
  TabMessage,
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:3000";
const POLL_ALARM = "shop-rules-poll-alerts";
const POLL_MINUTES = 15;
const BADGE_COLOR = "#008060";
const NOTIFICATION_PREFIX = "shop-rules-alert-";

interface ApiError {
  error: string;
  code: ApiErrorCode;
  status?: number;
}

function apiError(error: string, code: ApiErrorCode, status?: number): ApiError {
  return status === undefined ? { error, code } : { error, code, status };
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "error" in value && "code" in value;
}

function toFailure(err: unknown): ApiFailure {
  if (isApiError(err)) return { ok: false, ...err };
  return { ok: false, code: "internal", error: err instanceof Error ? err.message : String(err) };
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BASE_URL;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get({ baseUrl: DEFAULT_BASE_URL, token: "" });
  return {
    baseUrl: normalizeBaseUrl(String(stored.baseUrl ?? "")),
    token: String(stored.token ?? "").trim(),
  };
}

function readErrorMessage(body: unknown, res: Response): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const message = (body as { error: unknown }).error;
    if (typeof message === "string" && message) return message;
  }
  return `Shop Rules returned ${res.status} ${res.statusText}`.trim();
}

// Calls the Shop Rules API with the stored token. Resolves with parsed JSON
// or rejects with { error, code }.
async function api<T>(path: string, init: RequestInit = {}, requireToken = true): Promise<T> {
  const { baseUrl, token } = await getSettings();
  if (requireToken && !token) {
    throw apiError("Paste your account token in the Shop Rules popup to connect.", "unconfigured");
  }
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("X-SR-Token", token);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch {
    throw apiError(`Could not reach ${baseUrl}. Check the URL in the popup and that the app is running.`, "network");
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code: ApiErrorCode = res.status === 401 || res.status === 403 ? "auth" : "http";
    throw apiError(readErrorMessage(body, res), code, res.status);
  }
  if (body === null) throw apiError("Shop Rules returned an empty response.", "http", res.status);
  return body as T;
}

function post(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

// Message routing

async function handle(message: BgRequest): Promise<unknown> {
  switch (message.type) {
    case "lookup":
      return api(`/api/lookup?url=${encodeURIComponent(message.url)}`);
    case "watch":
      return api("/api/products", post({ url: message.url, page: message.page }));
    case "product":
      return api(`/api/products/${encodeURIComponent(message.id)}`);
    case "compare":
      return api("/api/compare", post(message.body));
    case "alerts":
      return api("/api/alerts?status=new");
    case "health":
      return api("/api/health", {}, false);
    case "check":
      return api(`/api/products/${encodeURIComponent(message.id)}/check`, post({ force: message.force ?? true }));
    case "account":
      return api("/api/account");
    case "alertStatus":
      return api(`/api/alerts/${encodeURIComponent(message.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: message.status, ...(message.reason ? { reason: message.reason } : {}) }),
      });
    case "settings":
      return getSettings();
    case "open-popup":
      return openPopup();
    case "poll":
      return pollAlerts();
    default: {
      const unknownMessage: never = message;
      throw apiError(`Unknown message: ${JSON.stringify(unknownMessage)}`, "internal");
    }
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (r: BgResult<unknown>) => void) => {
  if (typeof message !== "object" || message === null || !("type" in message)) return false;
  handle(message as BgRequest)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: unknown) => sendResponse(toFailure(err)));
  return true;
});

async function openPopup(): Promise<{ opened: boolean }> {
  try {
    await chrome.action.openPopup();
    return { opened: true };
  } catch {
    return { opened: false };
  }
}

// Alert polling and badge

async function setBadge(count: number): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  if ("setBadgeTextColor" in chrome.action) await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
}

function notify(alert: Alert, added: number): void {
  const detail = [alert.product_title, alert.action?.title].filter(Boolean).join(": ");
  chrome.notifications.create(`${NOTIFICATION_PREFIX}${alert.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: alert.headline,
    message: detail || "Open Shop Rules to review the alert.",
    contextMessage: added === 1 ? "1 new alert" : `${added} new alerts`,
  });
}

async function pollAlerts(): Promise<{ count: number }> {
  const { token } = await getSettings();
  if (!token) {
    await setBadge(0);
    return { count: 0 };
  }
  let alerts: Alert[];
  try {
    ({ alerts } = await api<AlertsResponse>("/api/alerts?status=new"));
  } catch (err) {
    console.error("Shop Rules: alert poll failed", err);
    return { count: -1 };
  }
  const count = alerts.length;
  await setBadge(count);
  const stored = await chrome.storage.local.get({ lastAlertCount: 0 });
  const previous = Number(stored.lastAlertCount ?? 0);
  const newest = alerts[0];
  if (count > previous && newest) notify(newest, count - previous);
  await chrome.storage.local.set({ lastAlertCount: count, lastPolledAt: Date.now() });
  return { count };
}

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(POLL_ALARM);
  if (!existing) await chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_MINUTES, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm();
  void pollAlerts();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm();
  void pollAlerts();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void pollAlerts();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.token || changes.baseUrl)) void pollAlerts();
});

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith(NOTIFICATION_PREFIX)) return;
  chrome.notifications.clear(id);
  void getSettings().then(({ baseUrl }) => chrome.tabs.create({ url: `${baseUrl}/alerts` }));
});

// Keyboard command

async function activeTabId(tab?: chrome.tabs.Tab): Promise<number | undefined> {
  if (tab?.id !== undefined) return tab.id;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active?.id;
}

async function openPanelInTab(tabId: number): Promise<void> {
  const message: TabMessage = { type: "open-panel" };
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return;
  } catch {
    // No content script yet. The command grants activeTab, so inject it now
    // (this is how custom-domain Shopify stores get the panel on demand).
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.error("Shop Rules: could not open the panel in this tab", err);
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "open-panel") return;
  void activeTabId(tab).then((tabId) => {
    if (tabId !== undefined) return openPanelInTab(tabId);
    return undefined;
  });
});
