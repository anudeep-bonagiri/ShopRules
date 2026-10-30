# Shop Rules: competitor teardown, feature matrix, and merge-and-improve spec

Date: 2026-10-29. Time box: about 75 minutes. Scope: six Chrome extensions torn down statically (never executed), plus web research on Avalara, TaxJar, Shopify Tax, Shopify Markets duties, and Amazon Seller Central compliance.

Evidence root for all extension paths below: `/private/tmp/claude-501/-Users-anudeepbonagiri/839cf007-71b7-4e2f-b195-a4da97ed19b7/scratchpad/competitors/`. A path like `keepa/unpacked/content.js:432` means that file under the evidence root, line 432. Scripts I wrote live in `_tools/` under the same root.

## 1. Method

Downloads. `_tools/fetch_crx.sh` pulls each CRX from the standard update URL (`clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx2,crx3&x=id%3D<ID>%26uc`). Four IDs worked first try. Two of the IDs given in the brief returned HTTP 404 `error-unknownApplication`: Helium 10 `njmehopjdpcckochcggncklnlmikcbhb` (one letter off) and Jungle Scout `gpaoddpkkjmgjpnfpjmbcojigkddjdfd`. Store search gave the live IDs, which downloaded fine: Helium 10 `njmehopjdpcckochcggncklnlmikcbnb` (https://chromewebstore.google.com/detail/njmehopjdpcckochcggncklnlmikcbnb) and Jungle Scout `bckjlihkmgolmgkchbpiponapgjenaoa` (https://chrome.google.com/webstore/detail/jungle-scout-extension/bckjlihkmgolmgkchbpiponapgjenaoa). Raw files: `<name>/<name>.crx`.

Unpacking. `_tools/crx2zip.py` strips the CRX3 header (12 bytes plus header length) and extracts the zip to `<name>/unpacked/`, with a zip-slip check. All six are CRX3. Sizes: Keepa 15 files, Camelizer 43, Honey 327, AMZScout 201, Helium 10 48, Jungle Scout 22.

REA. Per the README (`_tools/rea_README.md` line 119-123) and `docs/cli.md` (`_tools/rea_cli.md` line 15), the terminal command for an extracted JavaScript app directory is:

```
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/unpacked --json
```

REA requires Node 24.x at or above 24.22.1 (README line 189); the default shell Node is 24.4.1, so the wrapper `_tools/run_rea.sh` prepends `~/.cache/cruze-tools/node-v24.22.1-darwin-arm64/bin` to PATH and runs from `_tools/`, outside the target directories. First run failed before reaching npx because macOS has no `timeout` binary (`_tools/rea_run1.log`); the wrapper now uses `perl -e 'alarm shift; exec @ARGV' 540` and the rerun log is `_tools/rea_run3.log`. REA JSON output per extension is `<name>/rea.json` with stderr in `<name>/rea.stderr`. Result status is recorded in the "REA run outcome" note at the end of this section.

Manual static analysis, used for every claim below regardless of REA: `_tools/hosts.sh` extracts hostnames from all `.js`, `.html`, `.json` files; manifests were dumped with a Python one-liner; feature vocab came from `_locales/en/messages.json` where present (Camelizer, AMZScout) or from i18n bundles (`helium10/unpacked/vendor-i18n.js`, Jungle Scout `extension:*` keys); trigger gestures from grepping content scripts for `commands`, `action.onClicked`, `default_popup`, `keydown`, `hover`, `floating`, `iframe`.

Web research for the five non-extension products was delegated to two research passes; every claim carries its URL inline.

REA run outcome. Completed for Keepa (54 s, `keepa/rea.json` 50 MB), Camelizer (31 s, 124 MB), and Jungle Scout (3 min 6 s, 207 MB); Helium 10, AMZScout, and Honey were still running or queued when this document was written (`_tools/rea_run3.log` has the timings). Digests were produced with `_tools/rea_summary.py` and `_tools/rea_endpoints.py`. What REA added beyond grep: for Keepa, 14 endpoint nodes including a `call:WebSocket` mechanism in the service worker and candidate keys `revealStock`, `token`, `/extension`, plus 95 findings over 5 parsed files (`statistics.findings`). For Jungle Scout, 28 endpoint nodes including the WebSocket `wss://ws.ext-xs-prod.junglescout.com/ws`, two Seller Central same-origin calls built as `"https://" + window.location.host + "/business-reports/api"` and `"/orders-api/manifest-v3"`, the DataDome header `X-DD-B`, and routes `api/v2/logs`, `api/v1/chrome_extensions/dashboard`, `seller_accounts`, `ppc_campaigns/grouped_by_keywords`; 868 webpack modules; and two resource-limit notes (the 1024 MiB worker heap was exhausted on `js/chunks/_0bc0478e.js`, and semantic analysis of `js/chunks/_f82e0cd2.js` was not started because the result budget was reserved for static facts). For Camelizer REA found 327 modules, 4 storage nodes, and 3 source maps but no endpoint nodes, consistent with its URLs being assembled at runtime in `service_worker.js`. REA's own limitations list applies to everything cited from it: code was parsed as inert text, nothing was executed, and static endpoints do not prove runtime calls (`normalized_result.limitations` in each `rea.json`).

## 2. Per competitor

### 2.1 Keepa Amazon Price Tracker 5.75 (`neebplgakaahbhdphmkckjjcegoiijjo`)

Trigger gesture. Page inject, zero clicks. `content.js` runs at `document_start` on 14 Amazon TLDs plus keepa.com (`keepa/unpacked/manifest.json` content_scripts). It finds an anchor node (`#ATFCriticalFeaturesDataContainer`, `#hover-zoom-end`, `#tabular_feature_div`, `.a-fixed-left-grid`, `.twisterMediaMatrix`, `#handleBuy`; `content.js:340-352`), creates `div#keepaContainer` and an `<iframe src="https://keepa.com/keepaBox.html">` (`content.js:420-440`). If no anchor is found it retries up to 10 times at 3 second intervals, and when it still cannot place the box it inserts a dark `#keepaButton` the user clicks to open it (`content.js:470-482`). The toolbar icon has no popup; its title reads "Keepa automatically loads on Amazon product pages." and clicks are handled in `keepa.js` (`action.onClicked`). A right-click context menu "View products on Keepa" exists (`keepa.js:1718`). No keyboard shortcut: `commands` is absent and the `keydown` listener at `content.js:1548` is an idle detector alongside `mousemove` and `touchstart`. `selectionHook.js` is injected into the page's main world to hook Amazon's twister controller and post the newly selected child ASIN so the box follows variation changes (`keepa/unpacked/selectionHook.js`).

What the overlay shows. A price-history chart hosted on keepa.com. The static image fallback at `content.js:1655` lists the series: Amazon, New, Used, Sales Rank, FBA, FBM, Buy Box, Lightning Deal, Buy Box Used, Prime Exclusive, Warehouse, with a `range` in days. A newer "offers panel" annotates Amazon's own seller offer rows with per-offer price and stock sparklines (`content.js:1740-1770`, message kinds `offersPanelData` and `offersPanelChart` with `kind` of `price` or `stock`, element `keepa-panel-summary`, settings at `https://keepa.com/settings/extension/offersPanel` at `content.js:997`). Keepa's own `welcome.html` says "No need to click the toolbar icon - the Keepa box appears automatically."

Data sources. `keepa.com` (iframe, `/cdn/dict/`), `graph.keepa.com` (`/pricehistory.png`, `/pass`), `dyn.keepa.com`, `dyn-2.keepa.com` (`/service/bugreport/`, `/app/stats/?type=uninstall`), `test.keepa.com` (`_tools/hosts.sh keepa/unpacked`; `keepa/unpacked/keepa.js`). REA flagged a `call:WebSocket` endpoint in the service worker; the grep confirms it as `wss://dyn.keepa.com/apps/cloud/` at `keepa/unpacked/keepa.js:1991`, so the offers panel and stock data arrive over a persistent socket rather than per-request fetches.

Permissions. `alarms, storage, declarativeNetRequestWithHostAccess, cookies, contextMenus, offscreen, webRequest`; host permissions `*.keepa.com` plus 14 Amazon TLDs; content script `all_frames: true` (`keepa/unpacked/manifest.json`).

UI patterns worth copying. Anchor-with-fallbacks placement under the buy box; scale-to-fit transform for narrow layouts (`content.js:430`); variation hook so the panel tracks the selected child; heavy UI isolated in a first-party iframe so host CSS cannot break it and the extension stays at 78 KB; per-offer sparklines inline in the seller list.

Weaknesses. Amazon only. Buyer framing (price drops), so a seller only gets competitor context. No shortcut, no hover. Every product view sends the ASIN to keepa.com. `webRequest` plus `cookies` is a heavy grant for a chart.

### 2.2 The Camelizer 3.0.16 (`ghnomdcacenbmilgjigehppbamfndblo`)

Trigger gesture. Toolbar popup (`action.default_popup: main.html`) or keyboard shortcut `Alt+Shift+C` bound to `_execute_action` on all platforms (`camelizer/unpacked/manifest.json` commands). There is no content script. On open, `service_worker.js` uses `scripting.executeScript` under `activeTab` to run `get_asin.js` (reads `input#ASIN`) and `get_all_anchors.js` (collects product links on the page) (`camelizer/unpacked/get_asin.js`; `service_worker.js:515`). Help text: "Visit a product page at Amazon. The Camelizer icon will appear in the address or extensions bar; click it." (`camelizer/unpacked/_locales/en/messages.json` key `tab_help_howto_p0`).

What the overlay shows. A popup (800x600 default or 640x480 small, `main.html` options) with sidebar tabs Price History, Chart Options, Other Products, Your Camel Account, Settings, About (`messages.json` keys `sidebar_*`). Price History: chart image from camelcamelcamel with period 1 Month / 3 Months / 6 Months / 1 Year / All Time; a watch table with columns Price Type, Lowest Price, Highest Price, Current Price, Desired Price; email field "We'll send price drops to:" and a "Save Price Watches" button (`tab_price_history_*` keys; `main.html` shows three price-type rows with `$123.12 (Nov 10, 1999)` placeholders). Chart Options: toggle each price type, "Close-up View" (y axis starts near the lowest price), "Remove Outliers" (`chart_options_*` keys). Other Products: "Click a product's title to view its price history information" (`tab_pageproducts_*`).

Data sources. `camelcamelcamel.com` paths `/product/`, `/chromelizer/`, `/cpe/`, `/ddb/`, `/camelizer/first_run`, `/camelizer/last_run`, and `hello.camelcamelcamel.com/camelizer` (`camelizer/unpacked/service_worker.js`). Amazon TLDs com, co.uk, fr, de, es, ca, it, com.au.

Permissions. `scripting, activeTab, storage`; hosts camelcamelcamel.com plus 8 Amazon TLDs. Lightest footprint of the six.

UI patterns worth copying. One shortcut opens the panel for the product on the current tab; "Other Products on this page" built from anchors so it also works on search pages; the desired-price row sitting next to lowest, highest, and current; the help tab states no third-party analytics, ads, or affiliate links (`tab_help_disclaimer_p0`).

Weaknesses. The chart is a static PNG. The popup closes on focus loss. About 1 MB of jQuery, Foundation, and tooltipster to show an image (`camelizer/unpacked/foundation.js` 549 KB). Buyer only; no fees, no competitors, no rules.

### 2.3 PayPal Honey 19.8.0 (`bmnlcjabgnpnenekpadlanbbkooimhnj`)

Trigger gesture. A small gate script `h1-check.js` runs on every http and https page at `document_end` (`honey/unpacked/manifest.json`); it decides whether the page is a supported store (store list from `cdn-checkout.joinhoney.com/honey-checkout/stores.json` and `o.honey.io/store/`) and then loads the heavy bundles. UI is page-injected on product pages and at checkout (strings `pdp` x20 and `isCheckout` in `h1-main.js`, `h2.js`, `h1-check.js`), plus a 360x600 toolbar popover (`honey/unpacked/popover/popover.html`). No manifest `commands`; `keydown` listeners belong to its own widgets.

What the overlay shows. Coupon auto-apply at checkout (`applyCoupons`, `/api/v1/coupons/claim`, `/api/v1/cart/details`), PayPal Rewards / Honey Gold, a "Droplist" watch list with "notify" and "price history" and "best price" (string counts: Droplist 16, best price 8, price history 6, notify 6 in `h1-main.js`, `h2.js`, `h1-popover.js`). Amazon has a dedicated module (`amazon` strings and `images-na.ssl-images-amazon.com` references) that compares other sellers of the same item. Per-retailer checkout selectors are shipped for hundreds of stores (walmart, homedepot, macys, sephora, jcpenney, and others appear in `_tools/hosts.sh honey/unpacked`).

Data sources. `d.joinhoney.com` (`/v3`, `/features/owner/`, `/extdata/ckdata`), `s.joinhoney.com` (`/evs`, `/ev/` events), `o.joinhoney.com`, `o.honey.io/store/`, `out.joinhoney.com`, `extension.joinhoney.com`, `dash.joinhoney.com/product-catalog/product`, `cdn-checkout.joinhoney.com`, `cdn.honey.io`, `www.paypal.com/smart/buttons`, `history.paypal.com/targeting/set-plugin`; store module config from `/v2/stores/modules/list` and `/v2/stores/module/` (`honey/unpacked/h0.js`, `h2.js`).

Permissions. `alarms, cookies, storage, unlimitedStorage, scripting, webRequest, offscreen`; hosts `http://*/*` and `https://*/*`. Web-accessible `extensionMixinScripts/` include `blockWindowAlert.js`, `blockWindowConfirm.js`, `blockWindowPrompt.js`, and `clickElementThruPage.js`, used to drive checkout pages (`honey/unpacked/extensionMixinScripts/`).

UI patterns worth copying. Gate script that loads the heavy bundle only on known sites; per-store selector modules fetched at runtime so selectors update without a store release; a watch list with notify.

Weaknesses. About 20 MB of JavaScript (`h1-vendors-main-popover.js` alone is 6 MB), all-URL host access, and the checkout interrupt is the exact behavior a seller tool must avoid. Nothing on fees, rules, tariffs, or tax. The strings `nexus` and `tariffe` in Honey's bundles are a TLD list and an Italian localization, not features.

### 2.4 AMZScout PRO 2.5.7.4 (`njopapoodmifmcogpingplfphojnfeea`)

Trigger gesture. Toolbar icon click (`action` has `default_icon` only; `action.onClicked` in `amzscout/unpacked/background.js`) opens an in-page panel (`.as-pro-container`, 243 CSS rules in `amzscout/unpacked/bundle.css`) on Amazon search, category, and product pages; `bundle.js` and `bundle.css` are content scripts at `document_start` on 15 Amazon TLDs. Inline widgets are also injected on product pages: `.amz-pr-widget-wrapper` (product research row) and `.amz-history-widget-wrapper` with a "Product History" modal. A second content script `sellerAi.js` runs on `chatgpt.com`, `chat.openai.com`, and `claude.ai` at `document_idle` and lists eight other extension IDs; its purpose was not fully determined in the time box, so treat it as a notable risk flag, not a feature (`amzscout/unpacked/manifest.json`; `amzscout/unpacked/sellerAi.js`). No `commands`; the `keydown` hits in `bundle.js` are d3 brush and jQuery event plumbing.

What the overlay shows (all from `amzscout/unpacked/_locales/en/messages.json`, 1,077 keys). Table columns: Product Name, Brand, Rank (BSR), AVG BSR per Month, Sales, Est Monthly Sales, Est Monthly Rev, Est Monthly Profit, FBA Fees, Net Margin, LQS, Category, Sellers, Seller Type (FBA, FBM, AMZ), Weight, Product Score for PL and for Reselling, BS (Best Seller badge), Parent ASIN Est. Sales and Revenue. Niche header: Avg. Sales Rank, Avg. Mo Sales, Avg. Mo Revenue, Niche Score (1 to 10), Saturation Score, Avg. Net Margin, Niche History. Product History modal: Rank History, Sales History, Price History. Profit Calculator: Product Cost, Product Price, Additional per Unit Cost, Package Weight, Package Size, Referral Fee, Closing Fee, Total FBA Fee, Profit per Unit. Actions: Add to Tracker, Export to CSV, Get keywords, Get Title Keywords, Find on Alibaba, Find on Aliexpress, Suppliers for Niche (filters "Trade assurance only", "Verified only"), Hide sponsored, Trends. Plain-language verdict bands: `os_niche_1..4` ("Hard to succeed" to "Very likely to succeed"), saturation bands, LQS bands with a reason line, and "friendly N/A" cells that explain why a number is missing (`friendyNASales`, `friendyNAInventory`).

Data sources. `amzscout.net/extensions/scoutpro/v1/` endpoints `products/`, `keywords/`, `fees/`, `alibaba`, `aianalyzer`, `niche/visit`, `users/me/kwt/track`, `config/calculator/fee`, `config/calculator/os/v2`, `reviews/variation`, `licences/`, `tracks/pro`, `instance/update`, `uninstall`; `amzscout.net/ad/api/ad` (in-extension ads); `amzscout.net/nservice/api`; `sellerhook.com`, `listing.sellerhook.com`; `hottest-deals.net`; `trends.google.com`; `m.media-amazon.com` (`_tools/hosts.sh amzscout/unpacked`; `bundle.js`).

Permissions. `background, activeTab, tabs, storage, unlimitedStorage, cookies, identity, alarms`; host `*://*/*`; CSP allows `wasm-unsafe-eval` (`amzscout/unpacked/manifest.json`).

UI patterns worth copying. A verdict band in words next to every score; a tooltip on every column header (`t2`, `t10`); "friendly N/A" with the reason; one-click Add to Tracker; CSV export.

Weaknesses. Heavy upsell (`images/paywall/`, `images/ad/`, `trialEndedAlert`), 5.4 MB Angular-era bundle, all-URL host access for an Amazon-only tool, injection into AI chat sites. Research only: the words `tariff`, `compliance`, and `certification` in `bundle.js` are a plan tier field (`this.tariff=N.tariff`), a part-of-speech dictionary, and OEKO-TEX copy in sample product data, not features.

### 2.5 Helium 10 8.43.9 (`njmehopjdpcckochcggncklnlmikcbnb`)

Trigger gesture. A floating widget button injected on Amazon pages (React; `widgetPosition`, `widgetButtonClicked` Segment event, `widgetMenuXray` location string in `helium10/unpacked/amazon-script.js`), a draggable modal (`modalDragHandle`), and a toolbar popup (`action.default_popup: popup.html`). No `commands`. Content scripts at `document_end` on 15 Amazon TLDs, `walmart.com`, TikTok Shop (with a `MAIN`-world `tiktok-bridge.js` at `document_start`), Helium 10's own domains, and a `shopify-script.js` entry (`helium10/unpacked/manifest.json`). The code also references 14 `sellercentral.amazon.*` hosts and a `get-country-by-seller` endpoint.

What the overlay shows. The widget menu lists Xray, Xray Keywords, ASIN Grabber, Profitability Calculator, Review Insights, Listing Analyzer, Listing Health Score, Sales Estimator, Inventory Levels, Demand Analyzer, Supplier Finder, Cerebro, Magnet, Alerts, Keyword Tracker, My List, Track Competitor, Influencer Finder and Influencer Videos (`helium10/unpacked/vendor-i18n.js` label counts; `amazon-script.js` i18n keys `xray`, `profitabilityCalculator`, `reviewInsights`, `inventoryLevels`, `demandAnalyzer`, `supplierFinder`, `asinGrabber`). Xray table columns: ASIN, Brand, Price, Sales, Revenue, BSR, Fulfillment, Size Tier, Dimensions, Weight, Review Count, Rating, Images, Seller Country/Region, Category, Creation Date, Listing Age, Variations, Sponsored, Best Seller, Amazon Choice, Parent Level Sales, Active Sellers, Fees, Net Profit, Margin, ROI, Sales to Reviews (`vendor-i18n.js`). Profitability Calculator state includes `unitManufacturingCost`, `estFreightCost`, `freightType`, `otherCost` (percent or currency), `refFeePercent`, `fbaCategory`, `storageCost`, `vatRate`, `shippingMethod`, `deliveryType` FBA or FBM, and `dutiesAndTariffs` with `dutiesAndTariffsType` of `percent` or `currency`, computed as `dutiesAndTariffs * unitManufacturingCost / 100` when percent (`amazon-script.js`, function `eD`). This is the only competitor that models tariffs at all, and only as a number the seller types in.

Data sources. `members.helium10.com` (`/api/v1/customers/me`, `/api/v1/product`, `/api/v1/keywordtracker/*`, `/api/v1/ideas`, `/api/v1/amazon/cpc-history`, `/api/trends/get-google-trends`, `/api/v1/chrome-extension/get-child-sales-performance`, `/extension/calculator-v2`), `research-tools.helium10.com` (`/api/xray/v1/searches/`), `h10api.pacvue.com` (`/rta`, `/rta/v1/cerebro/phrase/translate`, `/prp/v1/coupon/public/uuid`), `control-center.helium10.com`, `re-cdn.helium10.com`, `members.h10.com.cn`, `survey.survicate.com`, `helium10extension.notion.site` (`_tools/hosts.sh helium10/unpacked`; `amazon-script.js`; `background-script.js`).

Permissions. `background, activeTab, tabs, storage, unlimitedStorage, browsingData`; host `*://*/*` (`helium10/unpacked/manifest.json`).

UI patterns worth copying. One floating launcher with a menu of tools; draggable modal; "Track Competitor" directly from the BSR widget; training links inside each tool; a calculator that already has a duties line, which Shop Rules can replace with a sourced rate; multi-marketplace content scripts selected by host.

Weaknesses. Tariffs are an unsourced manual input with no change tracking. About 12 MB of scripts on every Amazon page (`vendor-i18n.js` 3.1 MB, `vendors.js` 2.3 MB). All-URL host access and `browsingData`. Dense research tables, not a seller's own-catalog view. Usage caps ("Xray limit reached").

### 2.6 Jungle Scout 9.2.9 (`bckjlihkmgolmgkchbpiponapgjenaoa`)

Trigger gesture. A draggable floating button whose position persists under `js-floating-button-position` (56 px; actions "Go to Jungle Scout", "Hide the Jungle Scout button", "Copy ASINs") on Amazon pages (`junglescout/unpacked/js/chunks/_f82e0cd2.js`); the toolbar icon has no popup and `action.onClicked` opens the same panel (`js/background/index.js`, `js/extension.js`). Menu actions: "Scan Search Results", "Copy ASINS", "Search Amazon" (`extension:Menu.actions.*`). Inline "Product Embed" cards on each search result (`extension:EmbedCard.*`: Daily Sales, Monthly Sales, Monthly Revenue, Track Product, Add to Product Tracker, Copy ASIN). Content scripts run on `<all_urls>` with eight chunks; `web_accessible_resources` is `*` on `<all_urls>` (`junglescout/unpacked/manifest.json`). No `commands`; the `hotkey` strings are the Radix toast F8 binding, not a launcher shortcut.

What the overlay shows. Product page panel with tabs Product Details, Keywords, Historical Performance (a trends view with "Set trends (n/count)" metric picker), Review Analysis (ReviewsAI), Variants (`extension:ProductPage.tabs.*`). Scan summary header: Avg Monthly Sales, Avg Price, Avg BSR, Avg Reviews, Average Rating Number, Opportunity Score, Export time (`extension:Summary.*`). Table columns: ASIN, Brand, Price, Mo. Sales, Mo. Revenue, Rank, Category, Reviews, Rating, Sellers, Net, Weight, Dimensions, Tier, LQS, Date First Available, Fulfillment, Variants, Buy Box Owner, Opportunity Score, Net Profit. Other modules: Revenue Calculator, Download Reviews floating button, Share of Voice, Keyword Scout, Supplier Database link, Product Tracker, and a Seller Central augmentation (`extension:SellerCentral.*`; endpoints `api/v1/chrome_extensions/seller_accounts`, `ppc_campaigns/grouped_by_keywords`, `dashboard`).

Data sources. `ext.junglescout.com`, `config.ext.junglescout.com` (remote config), `members.junglescout.com` (`api/v1/chrome_extensions/*`, `api/v2/extension`, `api/v2/logs`, `#/supplier/results`), a `lambda-url.us-west-2.on.aws` function, `dh2wkbcb9yv3l.cloudfront.net`, `static.devs.junglescout.com`; telemetry to `logs.browser-intake-datadoghq.com`, Amplitude, Segment; `geo.captcha-delivery.com` (DataDome) (`_tools/hosts.sh junglescout/unpacked`). REA endpoint nodes add a WebSocket `wss://ws.ext-xs-prod.junglescout.com/ws` and two same-origin calls made while on Seller Central, `https://<current host>/business-reports/api` and `https://<current host>/orders-api/manifest-v3`, which is how the Seller Central augmentation reads the seller's own reports: a POST with a GraphQL-style `operationName: "report..."` body to `/business-reports/api`, and a GET of `/orders-api/manifest-v3` that reads the `x-amz-rid` response header (`junglescout/rea.json` graph nodes of kind `endpoint`, extracted by `_tools/rea_endpoints.py`; confirmed by grep in `junglescout/unpacked/js/chunks/`).

Permissions. `tabs, storage, scripting, unlimitedStorage, alarms, declarativeNetRequestWithHostAccess`; host `https://*/*` (`junglescout/unpacked/manifest.json`).

UI patterns worth copying. Persisted draggable launcher with a "hide me" affordance; per-result embed card with a Track button; tabbed product panel with a user-picked metric set for the trend chart; remote config endpoint; showing the vendor's data inside the seller's own admin (Seller Central).

Weaknesses. Research first; nothing on rules or tax. About 4.4 MB loaded on every site via `<all_urls>`. Login-gated empty state. DataDome dependency.

### 2.7 Avalara (web only)

Tariffs and duties. AvaTax Cross-Border calculates duties and import taxes per transaction, can estimate without HS codes, supports DDP and DAP; no tariff-change monitoring is described (https://www.avalara.com/us/en/products/global-commerce-offerings/avatax-cross-border.html). Tariff Code Classification assigns HS, HTS, and Schedule B codes in automated, self-serve, and managed tiers (https://www.avalara.com/us/en/products/tariff-code-classification.html).

Product compliance. Tax codes and AI item classification from product images (https://www.avalara.com/us/en/products/calculations.html); "Trade Restrictions Management" on the cross-border page (https://www.avalara.com/us/en/products/industry-solutions/cross-border-solutions.html). No product-safety rules.

State nexus. Continuous economic nexus tracking with alerts and guided registration (https://www.avalara.com/us/en/products/calculations.html); a heat map that alerts when approaching a threshold, with weekly evaluation against each state's lookback (https://www.avalara.com/us/en/learn/guides/small-business-faq/sales-tax-nexus-101.html); a color-coded jurisdiction status summary in the NetSuite app (https://www.avalara.com/us/en/blog/avalara-product-pulse-july-clearer-costs-smoother-compliance.html); a free no-account Sales Tax Readiness Report for QuickBooks Online users launched 2026-10-27 (https://newsroom.avalara.com/2026-10-27-Avalara-Launches-Nexus-Report-for-Intuit-QuickBooks-R-Online-Users).

Where it lives. AvaTax dashboard, API, Shopify checkout partner, Etsy and Amazon order extractors (https://www.avalara.com/us/en/products/integrations/shopify.html; https://knowledge.avalara.com/bundle/qyk1665570213410_qyk1665570213410/page/Connect_to_AvaTax.html).

Weaknesses for a solo seller. $79 per state per month or $799 per state per year, registration $403 per location (https://www.avalara.com/us/en/products/pricing.html); cross-border has no public price; the nexus visuals live in blogs and ERP add-ons.

Patterns worth copying. The free no-account readiness report; color-coded jurisdiction status with weekly re-evaluation.

### 2.8 TaxJar (Stripe, web only)

Tariffs and duties. None; TaxJar refers tariff management to Zonos (https://www.taxjar.com/blog/2025-income-and-sales-tax-changes) and no longer offers international calculation to new customers (https://support.taxjar.com/article/22-does-taxjar-support-vat-or-canada).

Product compliance. None beyond tax categories for exemptions (https://www.taxjar.com/product/integration/etsy).

State nexus. Economic Nexus Insights tracks exposure per state and alerts as you approach or reach thresholds (https://www.taxjar.com/product/nexus-insights); a state appears on the dashboard once you reach 75 percent of its threshold (https://support.taxjar.com/article/1141-post-setup-taxjar-tasks); marketplace, wholesale, and free orders are excluded where a state excludes them and refunds count as negatives (https://www.taxjar.com/blog/2022-04-how-refunds-factor-into-economic-nexus-thresholds).

Where it lives. Web dashboard with daily order sync; one-click Etsy and Amazon links; Shopify app (https://www.taxjar.com/product/integration; https://support.taxjar.com/article/1137-set-up-your-shopify-integration).

Weaknesses. Starter $39 per month for 200 orders, Professional $99, registration $299 (https://support.taxjar.com/article/139-how-much-does-taxjar-cost); alerts on Professional and up (https://www.taxjar.com/blog/nexus/nexus-impacts-businesses-differently-depending-on-their-size); nothing shown before 75 percent; Stripe and NetSuite integrations closed to new users (https://developers.taxjar.com/integrations/guides/stripe-deprecated/).

Patterns worth copying. The 75 percent trigger with marketplace-facilitator exclusions applied per state; one-click marketplace linking.

### 2.9 Shopify Tax and Shopify Markets duties (web only)

Tariffs and duties. Shopify Tax itself has none (https://www.shopify.com/tax). Markets: per-product "Country of origin" and "Harmonized System (HS) code" fields with keyword search and per-country overrides, bulk editor columns, and a CSV path that exports products with missing information (https://help.shopify.com/en/manual/international/shipping/hs-codes). Per-market settings "Collect duties and import tax", "Show as line item" or "Duties included in price", "Reduce rates when preferential treaties allow", "Use postal duty rates into the United States", "Section 232 percentage"; missing HS codes fall back to description and category and "are likely to be inaccurate" (https://help.shopify.com/en/manual/international/duties-and-import-taxes/charging-duties). Shopify says its calculator reflects tariff changes as they take effect but does not say it notifies merchants (https://help.shopify.com/en/manual/international/duties-and-import-taxes/understanding-tariffs); US de minimis ended 2025-08-29 and the guidance is a manual checklist (https://help.shopify.com/en/manual/international/duties-and-import-taxes/understanding-customs-fees).

Product compliance. None; product categories are for tax rates, with "Suggested category" and "Confirmed category" states (https://help.shopify.com/en/manual/taxes/shopify-tax/product-categories-tax).

State nexus. The US tax liability page lists each state with the reason and date; statuses "Action required" (nexus crossed) and "Monitoring" (at or above 80 percent of the threshold, counting required marketplace sales); liability uses net sales over each state's own period; the page shows the month you crossed; a "Set up tax collection" button sits on the row (https://help.shopify.com/en/manual/taxes/us/us-tax-liability). Threshold amounts are in a separate reference table, for example Arkansas $100,000 or 200 orders, New York $500,000 and 100 orders (https://help.shopify.com/en/manual/taxes/us/us-tax-reference).

Where it lives. Settings, Taxes and duties, "Manage tax liability"; Markets settings per market.

Weaknesses. Only Shopify-processed sales count unless imported, so Etsy and Amazon volume is invisible; no documented threshold email; automated filing is closed to new enrollment (https://help.shopify.com/en/manual/taxes/shopify-tax/automated-filing/pricing); Shopify Tax is free to $100,000 then 0.35 percent per order capped at $0.99 (https://help.shopify.com/en/manual/taxes/shopify-tax/pricing); no per-product "your rate changed" alert and no inbound sourcing view.

Patterns worth copying. The 80 percent "Monitoring" tier distinct from "Action required"; the fix action attached to the alert row; the "missing HS code or origin" product flag.

### 2.10 Amazon Seller Central compliance (web only)

Tariffs and duties. None inbound; the seller is importer of record and Amazon returns shipments with duties due; only Remote Fulfillment shows buyers a duty estimate (https://sell.amazon.com/global-selling/guide).

Product compliance. The Manage Your Compliance dashboard lists product, ASIN, SKU, "Compliance requirements", approval status, and an "At-risk sales" column, with spreadsheet submission up to 5,000 products (https://sell.amazon.com/blog/manage-your-compliance). Since 2024-09-30 requested documents must be approved before listing (https://sellercentral.amazon.com/seller-forums/discussions/t/b8054ac2-122e-4de6-bb81-72aa53980ea1). The toy TIC program sends a notification naming affected ASINs with a due date and surfaces them in Account Health (https://sellercentral.amazon.com/seller-forums/discussions/t/7925a57b-4be5-4176-a918-329133a4536c).

State nexus. None; Amazon collects as marketplace facilitator and gives Professional sellers a Marketplace Tax Collection Report under Tax Document Library (https://sellercentral.amazon.com/seller-forums/discussions/t/0ed5cbd4-1a1a-45cf-8afb-5d3ed0749436).

Weaknesses. Reactive and ASIN-triggered, no forward-looking rule feed, no tariff visibility, Individual plan lacks tax reports. Help pages require login, so claims rest on sell.amazon.com and Amazon-authored forum posts.

Patterns worth copying. "At-risk sales" dollar column to rank what to fix first; ASIN-specific notice with an explicit due date.

## 3. Feature matrix

Legend: Y = present, P = partial, N = absent. Shop Rules column: adopt, improve, or skip.

| Feature | Keepa | Camelizer | Honey | AMZScout | Helium 10 | Jungle Scout | Avalara | TaxJar | Shopify Tax/Markets | Seller Central | Shop Rules |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Auto-inject panel on product page | Y | N | Y | Y | Y | Y | N | N | N | N | improve (inject a badge, open panel on shortcut) |
| Keyboard shortcut to open | N | Y (Alt+Shift+C) | N | N | N | N | N | N | N | N | adopt |
| Hover-targeted trigger | N | N | N | N | N | N | N | N | N | N | adopt (hover plus shortcut, none have it) |
| Floating draggable launcher | N | N | N | N | Y | Y | N | N | N | N | adopt (small) |
| Toolbar popup | N | Y | Y | N | Y | N | N | N | N | N | skip |
| Price history chart | Y | Y | P | Y | P | Y | N | N | N | N | improve (own price plus competitor median, rule markers) |
| Competitor or other-seller prices | Y (offers panel) | N | P (best price) | P (sellers count) | P | P (Buy Box owner) | N | N | N | N | improve (seller framing) |
| Sales and revenue estimates | P (rank) | N | N | Y | Y | Y | N | N | N | N | skip |
| Fees and profit calculator | N | N | N | Y | Y | Y | N | N | N | N | improve (landed cost with sourced tariff) |
| Tariff or duty line in calculator | N | N | N | N | Y (manual percent) | N | Y (per transaction) | N | Y (checkout estimate) | N | improve |
| Tariff rate by HS code from official source | N | N | N | N | N | N | Y (classification product) | N | P (fallback estimate) | N | adopt |
| Tariff change alert per product | N | N | N | N | N | N | N | N | N | N | adopt (nobody has it) |
| Product safety or compliance rules per product | N | N | N | N | N | N | N | N | N | Y (requests) | improve (forward-looking, with source text) |
| Compliance document status and due date | N | N | N | N | N | N | N | N | N | Y | adopt |
| State economic nexus tracking | N | N | N | N | N | N | Y | Y | Y | N | improve (all three channels combined) |
| Approaching-threshold tier | N | N | N | N | N | N | Y | Y (75%) | Y (80% Monitoring) | N | improve (show runway from 0%) |
| Official source citation on each alert | N | N | N | N | N | N | N | N | P (help links) | P (notice) | adopt |
| Draft the fix (reprice or compliance step) | N | N | N | N | N | N | N | N | P (Set up tax collection button) | N | adopt |
| Watch or track product with notify | N | Y (price watch email) | Y (Droplist) | Y (Tracker) | Y (Alerts, Track Competitor) | Y (Product Tracker) | N | N | N | N | adopt |
| Plain-language verdict bands | N | N | N | Y | N | P (Opportunity Score) | N | N | N | N | adopt |
| At-risk revenue ranking | N | N | N | N | N | N | N | N | N | Y | adopt |
| Export CSV | N | N | N | Y | Y | Y | Y | Y | Y | Y | adopt (later) |
| Works on Etsy listings | N | N | P (coupons) | N | N | N | P (order import) | Y (orders) | N | N | adopt |
| Works on Shopify storefront or admin | N | N | P (coupons) | N | P (demand script) | N | Y | Y | Y | N | adopt |
| Works on Amazon listings | Y | Y | Y | Y | Y | Y | P | Y | N | Y | adopt |
| Seller Central augmentation | N | N | N | N | P | Y | N | N | N | n/a | skip for hackathon |
| Remote config for site selectors | N | N | Y | P (parser config endpoint) | N | Y | n/a | n/a | n/a | n/a | adopt |
| Coupon auto-apply or checkout interrupt | N | N | Y | N | N | N | N | N | N | N | skip |
| Keyword research, supplier finder, influencer tools | N | N | N | Y | Y | Y | N | N | N | N | skip |
| All-URL host permission | N | N | Y | Y | Y | Y | n/a | n/a | n/a | n/a | skip (scope to etsy.com, shopify admin, amazon) |

## 4. Merge and improve spec

Buyer-side features to skip: coupon auto-apply and checkout interrupts (Honey), rewards and cashback (Honey), buyer price-drop email (Camelizer), sales and revenue estimation, keyword research, supplier finders, influencer tools, in-extension ads, AI-chat-site injection (AMZScout, Helium 10, Jungle Scout).

Seller-side features to ship, 12 total:

1. Hover plus shortcut overlay. Hover any listing on Etsy, Shopify admin, or Amazon and press one shortcut; the panel anchors to that listing. Improves on Camelizer's `Alt+Shift+C` (which only targets the current tab's product) and Keepa's zero-click iframe (which only works on Amazon product pages) by working on list and grid pages and never injecting until asked.

2. Rules strip with three badges: Tariff, Safety, Sales tax. Nobody shows rules per product on the listing itself; Seller Central's dashboard is a separate page and Shopify's flags live in settings. Each badge carries a status color and a one-line summary.

3. Verified alert with the official source excerpt. Improves on Seller Central's ASIN notices and Shopify's tariff help pages by quoting the governing text (HTS line, CPSC rule, state statute) with the fetch date and a diff of what changed, so the seller can check it in ten seconds.

4. Tariff rate by HS code with change detection. Replaces Helium 10's manual `dutiesAndTariffs` percent and Shopify's silent recalculation with a looked-up rate per product HS code and origin, plus an alert when the rate or de minimis treatment changes.

5. Landed cost and margin line. Takes the calculator pattern from Helium 10, AMZScout, and Jungle Scout but shows only four numbers: your price, unit cost, landed cost at today's duty rate, margin; and the suggested price to hold the target margin.

6. Reprice draft. One click drafts the new price on Shopify, Etsy, or Amazon as an unpublished change the seller approves. Shopify's "Set up tax collection" button on the liability row is the closest existing pattern; no competitor drafts a price.

7. Compliance checklist per product with due dates. Improves on Seller Central's Manage Your Compliance by being forward-looking (rule effective dates, not just document requests), listing the document types, and applying to Etsy and Shopify products that Amazon never sees.

8. At-risk revenue ranking. Adopts Seller Central's "At-risk sales" column and applies it across all alerts, so the first item in the inbox is the one that costs the most if ignored.

9. Nexus meter across channels. Improves on Shopify (80 percent Monitoring, Shopify sales only) and TaxJar (75 percent, hidden before that) by combining Etsy, Shopify, and Amazon orders, showing every state from 0 percent with the threshold period and marketplace-facilitator exclusions, and alerting at 50, 75, and 100 percent.

10. Watch product. Adopts the Droplist, Product Tracker, and Track Competitor pattern, but a watch means rule changes plus competitor price moves for that product, delivered by email or Discord, with no checkout interrupts.

11. Price history with rule markers and competitor median. Adopts Keepa's series model (your price, competitor low, competitor median) and adds vertical markers at rule effective dates so the seller sees cause and effect.

12. Plain-language verdicts and friendly N/A. Adopts AMZScout's band text ("Likely to succeed") and reason-for-missing-data cells for every risk score, so an empty tariff field reads "No HS code on this product; add one to get a rate" instead of a dash.

Engineering patterns to adopt from the teardown: gate script that only loads the main bundle on the three supported hosts (Honey); remote selector config so Etsy or Amazon DOM changes do not need a store release (Honey, Jungle Scout); persisted draggable launcher with a hide affordance (Jungle Scout); minimal permissions (Camelizer: `activeTab, scripting, storage`, host list limited to the three sites); first-party iframe for the heavy panel so host CSS cannot break it (Keepa).

## 5. Overlay layout for the Shop Rules extension panel

Panel: 420 px wide, anchored to the hovered listing, draggable by the header, closes on Escape, first-party iframe inside a shadow-root host so host CSS does not leak in. Sections in order:

1. Header. Product thumbnail, title truncated to two lines, channel badge (Etsy, Shopify, Amazon), listing id or SKU or ASIN, a Watch toggle, data freshness timestamp, close button, and the shortcut hint.

2. Rules strip. Three badges in a row: Tariff, Safety, Sales tax. Each shows a status color (clear, watch, action), a one-line summary such as "HTS 6109.10 at 16.5% since 2026-09-01", and a "Verified against <source> on <date>" link. Clicking a badge expands section 3 for that rule.

3. Alert detail (collapsed until a badge is clicked). Rule title, effective date, what changed as old value to new value, the quoted official source excerpt, a confidence label, and the primary button "Draft the fix" (reprice for tariff, checklist item for safety, registration step for tax).

4. Price and margin. Four numbers in a row: your price, unit cost, landed cost at the current duty rate, margin percent. Below them the suggested price to hold the target margin and a "Create reprice draft" button. Friendly N/A text when cost or HS code is missing, with the field to fill.

5. Price history. Chart with a 90 day or 1 year toggle; series: your price, competitor low, competitor median; vertical markers at rule effective dates; hover tooltip with the values on that day.

6. Competitors. A five-row table: seller, price, shipping, fulfillment or ship-from, last seen; a line stating your rank among them ("You are 3rd of 7").

7. Compliance checklist. For the product's category: each required document or label, status (missing, submitted, approved), due date, and the at-risk revenue if it lapses.

8. Nexus footer. The seller's top three states by percent of threshold as meter bars with the state, percent, threshold period, and tier label (monitoring at 50, approaching at 75, action at 100), plus a "See all states" link to the web app.

9. Footer. "Open in Shop Rules" link, keyboard hints (Escape closes, W toggles watch, D opens draft), and a one-line note on which sources were checked and when.
