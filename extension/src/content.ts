// Content script: floating button on product pages, Alt-hover card
// highlighting on listing pages, the keyboard shortcut, and the panel.
import { send } from "./bridge";
import {
  detectMarketplace,
  extractPageProduct,
  findProductCardElement,
  isProductPage,
  productFromCard,
} from "./extract";
import { Panel } from "./panel";
import type { Marketplace, PageProduct, TabMessage } from "./types";

declare global {
  interface Window {
    __shopRulesLoaded?: boolean;
  }
}

const FAB_ID = "shop-rules-fab";
const HIGHLIGHT_ID = "shop-rules-highlight";
const OPEN_DEBOUNCE_MS = 300;
const TOAST_MS = 2200;
const GREEN = "#008060";
const FONT = 'Inter, -apple-system, "Segoe UI", sans-serif';

const SHIELD_SVG =
  '<svg width="18" height="18" viewBox="0 0 28 28" aria-hidden="true">' +
  '<path d="M14 5.5l7 2.7v5.3c0 4.4-3 8.4-7 9.5-4-1.1-7-5.1-7-9.5V8.2l7-2.7z" fill="#fff"/>' +
  `<path d="M10.6 14.2l2.3 2.3 4.6-4.8" stroke="${GREEN}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;

function makeHost(id: string, pointerEvents: "auto" | "none"): ShadowRoot {
  const host = document.createElement("div");
  host.id = id;
  const important: Record<string, string> = {
    all: "initial",
    position: "fixed",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    "z-index": "2147483646",
    display: "block",
    "pointer-events": pointerEvents,
  };
  for (const [prop, value] of Object.entries(important)) host.style.setProperty(prop, value, "important");
  document.documentElement.appendChild(host);
  return host.attachShadow({ mode: "open" });
}

// Floating button

interface Fab {
  setHidden(hidden: boolean): void;
}

function createFab(onClick: () => void): Fab {
  const root = makeHost(FAB_ID, "auto");
  root.innerHTML = `<style>
    :host { all: initial; }
    button {
      position: fixed; right: 16px; bottom: 16px; width: 36px; height: 36px; border-radius: 50%;
      background: ${GREEN}; color: #fff; border: 0; cursor: pointer; padding: 0;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25); font-family: ${FONT};
      transition: transform 120ms, opacity 120ms;
    }
    button:hover { transform: scale(1.06); }
    button.is-hidden { opacity: 0; pointer-events: none; }
  </style>
  <button type="button" title="Shop Rules (Alt+Shift+S)" aria-label="Open Shop Rules">${SHIELD_SVG}</button>`;
  const button = root.querySelector("button");
  button?.addEventListener("click", onClick);
  return {
    setHidden(hidden) {
      button?.classList.toggle("is-hidden", hidden);
    },
  };
}

// Card highlight and toast

interface Highlight {
  show(target: Element): void;
  hide(): void;
  toast(message: string): void;
  visible(): boolean;
}

function createHighlight(): Highlight {
  const root = makeHost(HIGHLIGHT_ID, "none");
  root.innerHTML = `<style>
    :host { all: initial; }
    .box { position: fixed; border: 2px solid ${GREEN}; border-radius: 8px; box-sizing: border-box; display: none; }
    .pill, .toast {
      position: fixed; background: ${GREEN}; color: #fff; font: 500 12px/1 ${FONT};
      padding: 6px 10px; border-radius: 999px; white-space: nowrap; display: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .toast { right: 16px; bottom: 64px; }
  </style>
  <div class="box"></div><div class="pill">Alt+Shift+S to inspect</div><div class="toast"></div>`;
  const box = root.querySelector<HTMLElement>(".box");
  const pill = root.querySelector<HTMLElement>(".pill");
  const toastEl = root.querySelector<HTMLElement>(".toast");
  let shown = false;
  let toastTimer = 0;
  return {
    show(target) {
      if (!box || !pill) return;
      const r = target.getBoundingClientRect();
      Object.assign(box.style, { display: "block", top: `${r.top - 2}px`, left: `${r.left - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
      const pillTop = r.top > 32 ? r.top - 30 : r.bottom + 6;
      Object.assign(pill.style, { display: "block", top: `${pillTop}px`, left: `${Math.max(8, r.left)}px` });
      shown = true;
    },
    hide() {
      if (!shown) return;
      if (box) box.style.display = "none";
      if (pill) pill.style.display = "none";
      shown = false;
    },
    toast(message) {
      if (!toastEl) return;
      toastEl.textContent = message;
      toastEl.style.display = "block";
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toastEl.style.display = "none";
      }, TOAST_MS);
    },
    visible: () => shown,
  };
}

// Wiring

function cardToPage(card: ReturnType<typeof productFromCard>): PageProduct | null {
  if (!card) return null;
  return { ...card, description: null, materials: null };
}

function isShortcut(event: KeyboardEvent): boolean {
  return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyS";
}

function boot(): void {
  const marketplace: Marketplace = detectMarketplace();
  const productPage = isProductPage(marketplace);
  const highlight = createHighlight();
  let fab: Fab | null = null;
  const panel = new Panel(send, (open) => {
    fab?.setHidden(open);
    if (open) highlight.hide();
  });
  if (productPage) fab = createFab(() => openPanel(extractPageProduct(marketplace)));

  let hovered: Element | null = null;
  let altHeld = false;
  let frame = 0;
  let lastOpenAt = 0;

  function openPanel(page: PageProduct): void {
    const now = Date.now();
    if (now - lastOpenAt < OPEN_DEBOUNCE_MS) return;
    lastOpenAt = now;
    panel.open(page, marketplace);
  }

  // The hovered card wins; otherwise the page's own product.
  function openForHoverOrPage(): void {
    const pageProduct = productPage ? extractPageProduct(marketplace) : null;
    const cardEl = findProductCardElement(hovered, marketplace);
    const card = cardEl ? cardToPage(productFromCard(cardEl, marketplace)) : null;
    if (card && card.url !== pageProduct?.url) {
      openPanel(card);
      return;
    }
    if (pageProduct) {
      openPanel(pageProduct);
      return;
    }
    highlight.toast("Hover a product, then press Alt+Shift+S");
  }

  function refreshHighlight(): void {
    frame = 0;
    if (!altHeld || panel.isOpen()) {
      highlight.hide();
      return;
    }
    const cardEl = findProductCardElement(hovered, marketplace);
    if (cardEl) highlight.show(cardEl);
    else highlight.hide();
  }

  function scheduleHighlight(): void {
    if (frame) return;
    frame = requestAnimationFrame(refreshHighlight);
  }

  document.addEventListener(
    "mouseover",
    (event) => {
      hovered = event.target instanceof Element ? event.target : null;
      if (altHeld) scheduleHighlight();
    },
    { capture: true, passive: true },
  );

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Alt" && !altHeld) {
        altHeld = true;
        scheduleHighlight();
      }
      if (isShortcut(event)) {
        event.preventDefault();
        openForHoverOrPage();
      }
    },
    true,
  );

  window.addEventListener(
    "keyup",
    (event) => {
      if (event.key !== "Alt") return;
      altHeld = false;
      highlight.hide();
    },
    true,
  );

  window.addEventListener("blur", () => {
    altHeld = false;
    highlight.hide();
  });

  const reposition = (): void => {
    if (highlight.visible()) scheduleHighlight();
  };
  window.addEventListener("scroll", reposition, { capture: true, passive: true });
  window.addEventListener("resize", reposition, { passive: true });

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (typeof message === "object" && message !== null && (message as TabMessage).type === "open-panel") {
      openForHoverOrPage();
    }
    return false;
  });
}

if (window.top === window && !window.__shopRulesLoaded) {
  window.__shopRulesLoaded = true;
  boot();
}

export {};
