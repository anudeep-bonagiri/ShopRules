# Shop Rules Chrome extension

The seller-side companion to the Shop Rules web app. On a product listing, hover a product and press the shortcut (or click the floating button) to see the rules that touch it, open alerts with verified evidence, price history, a landed-cost margin line, and competitor prices. "Watch this product" saves it to your Shop Rules account so the web app keeps checking it.

Works on Amazon, Etsy, and Shopify (both `*.myshopify.com` and stores on their own domain after you grant access).

## Install

Build once from the repo root:

```
npm install
npm run build -w extension
```

Then load it unpacked:

1. Open `chrome://extensions`.
2. Turn on Developer mode (top right).
3. Click "Load unpacked" and pick the `extension/dist` folder.

Or use the zip: `npm run zip -w extension` writes `extension/shop-rules-extension.zip`; unzip it anywhere and load that folder the same way.

While developing, `npm run watch -w extension` rebuilds on save. Reload the extension in `chrome://extensions` after each change.

## Configure

1. Pin the Shop Rules icon from the puzzle-piece menu in the Chrome toolbar.
2. Click it. Enter the Shop Rules URL (defaults to `https://shop-rules.vercel.app`; use `http://localhost:3000` when running the app locally).
3. Paste the account token from the web app's Settings page (it starts with `sr_live_`), then click Save.
4. Click "Test connection". The popup reports the app version, the Tavily mode (keyed or keyless), and whether Nemotron is configured.

Settings sync through `chrome.storage.sync`, so they follow your Chrome profile.

## Shortcut

`Alt+Shift+S` opens the panel. On a product page it opens for that product. On a search, shop, or collection page, hover a product first; holding `Alt` outlines the card under the cursor so you can see what the shortcut will target.

Change the binding at `chrome://extensions/shortcuts` if it clashes with something else.

## What the panel shows

The panel is a compact product inspector in the Shopify Polaris style. Sections, top to bottom:

1. Header: product thumbnail, channel pill (Amazon, Etsy, or Shopify with the store region), title, and a category line with the listing id (ASIN, Etsy listing id, or Shopify handle) and when the product was last checked.
2. Price block: retail price, landed cost (base) estimated as your unit cost share of retail (45% by default, or `unit_cost_pct` from your account Settings; change it inline for this product), and the resulting margin with your target.
3. Top open alert: severity, rule family, headline, the HS code when the product profile has one, the evidence bar (claims proposed, backed by the official source text, rejected by the verifier), and a 2x2 metric grid: duty rate hike, landed cost per unit (base vs after the change), net margin with a kept-vs-lost bar, and the projected weekly profit drag (cost delta times `units_per_week`, 20 by default).
4. Compliance audit: the product's safety and marketplace policy rules, each with a status pill ("Action needed" when an open alert exists, "Nothing new" with the last run time, or "Not checked yet") and the source domain the rule checks.
5. Recommended reprice (when the top alert drafts a price): the new price, the retail change, the margin it holds, and a "Draft reprice" button that copies the price to your clipboard and marks the alert actioned.
6. Actions: "Add to watchlist" (or "Run check now" once watched), "Export dossier" (downloads a JSON of the product, rules, alerts, price history, and competitor results), and a link to open the product in Shop Rules.
7. Price history: a sparkline of recorded prices with dashed markers on alert dates, plus the change since the product was first watched.
8. Compare: "Find competitor prices" searches Amazon, Etsy, Walmart, and eBay for the same product and shows up to five listings with your price position.

Press `Escape` or the close button to dismiss the panel.

## Shopify stores on a custom domain

The extension ships with access to `amazon.com`, `etsy.com`, and `myshopify.com`. For a Shopify store on its own domain, open the store in a tab, click the Shop Rules icon, and press "Grant access to this site". Chrome asks once; the extension then injects the panel on that site and registers it for future visits. Pressing the shortcut on such a page also works without the grant, because Chrome gives the extension one-time access to the active tab when you invoke it.

## Privacy

The extension sends only the listing URL and the fields it scraped from the page (title, price, currency, description, materials, image URL) to the Shop Rules server you configured. Nothing is sent to any third party by the extension itself; the server is what calls Tavily and Nemotron. The token lives in your Chrome profile's synced extension storage and is sent only as the `X-SR-Token` header to that server. The unit cost share you type into the panel stays on this device.

## Chrome Web Store packaging

1. Bump `version` in `extension/manifest.json`.
2. Run `npm run zip -w extension` from the repo root. This rebuilds `dist/` and writes `extension/shop-rules-extension.zip`.
3. In the Chrome Web Store developer dashboard, create or open the item and upload the zip.
4. Fill in the listing: the store needs a 128 px icon (already in the zip), at least one screenshot, and a privacy disclosure. Declare that the extension sends listing URLs and scraped page fields to the user's own Shop Rules server and nowhere else.
5. For production, the default URL in the popup is the production app; change `DEFAULT_BASE_URL` in `src/popup.ts` and `src/background.ts` for your own deployment.

Note that the `https://*/*` entry is under `optional_host_permissions`, so the store review sees only the three marketplace hosts plus the API hosts as required permissions.

## Layout

```
extension/
  manifest.json       MV3 manifest
  build.mjs           esbuild bundler (node build.mjs [--watch])
  tsconfig.json       strict TypeScript, DOM + chrome types
  popup.html/css      toolbar popup
  icons/              16, 32, 48, 128 px PNGs rendered from apps/web/public/icon.svg
  src/
    background.ts     service worker: API calls, alert polling, badge, notifications, shortcut relay
    content.ts        floating button, Alt-hover highlight, shortcut, panel wiring
    panel.ts          the Shadow DOM overlay
    extract.ts        marketplace detection, product and card extraction, price parsing
    popup.ts          popup logic
    bridge.ts         sendMessage helper used by content and popup
    types.ts          API types from docs/api.md
```
