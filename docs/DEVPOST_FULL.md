# Shop Rules: Devpost submission, every field

> Every number below is copied from `docs/FACTS.md` (run of 2026-10-30T02:26Z, after the Tavily domain-mode fix) unless it is listed in `docs/numbers_allowed.txt`. Re-run `scripts/facts.mts` once the sandbox project id is set and refresh the numbers marked FACTS.

---

## 1. Project overview

**Project name (60 max):**
Shop Rules

**Elevator pitch (200 max):**
The compliance clerk that quotes its sources. Shop Rules watches tariffs, product safety rules, and state nexus thresholds for each listing you sell, drops any alert it cannot quote, and drafts the reprice.

**Thumbnail (3:2):**
The product page with one tariff alert open: the alert card, the evidence counter, and the "Draft reprice" block. Fallback: the Watchlist feed with three priority cards.

---

## 2. About the project (Markdown, the public page)

### Shop Rules: the compliance clerk that quotes its sources

> **Hover a listing, press Alt+Shift+S, watch it. Tavily reads the official pages. Nemotron 3 decides. A verifier and deterministic guardrails drop what the page does not say. The reprice math is arithmetic, not a model. You approve the step.**

| | |
|---|---|
| **Try it** | https://shop-rules.vercel.app (click "Load demo shop", then open a product and run a check) |
| **Code** | https://github.com/anudeep-bonagiri/ShopRules |
| **Extension** | `extension/shop-rules-extension.zip` in the repo, loads unpacked |

### Inspiration

A solo seller on Etsy, Shopify, or Amazon is also the import compliance officer, the product safety officer, and the sales-tax department. Tariff rates on the goods they import changed repeatedly this year, de minimis treatment for low-value imports from China was suspended, and every state has its own nexus threshold. The information is public, on government pages, and nobody has time to read it for every product. The seller we built this for would rather be told "this rule touches this listing, here is the sentence, here is the new price" than be sent a newsletter.

### What it does

**The loop a seller lives in.** On any Amazon, Etsy, or Shopify listing, hover and press Alt+Shift+S. The extension reads the page (Shopify stores answer their public `.json`; JSON-LD and Open Graph otherwise) and shows a Product Stats HUD: price with its history, landed cost and margin, duty exposure with the tariff heading, weekly margin drag, and every rule that touches this product grouped as tariffs, safety, sales tax, and policy. One click watches it. From then on the seller is notified when its price moves past their threshold or when a rule changes, with a Chrome notification per alert and a badge count.

**Inspect and watch.** Watching reads the listing, classifies it with Nemotron 3 Nano (origin, materials, flags, and a four-digit tariff heading chosen from a curated catalog so the model cannot invent one), and seeds watch rules on official domains only: CBP, USTR, the Federal Register, CPSC, FDA, FTC, OEHHA, the revenue site of each ship-to state, and the marketplace's own policy pages. The seller can override any field (unit cost, origin, heading, materials) and the classifier never writes over it.

**Verify.** On every check, Tavily Search finds the official pages restricted to the rule's domains, Tavily Extract pulls the text, and Nemotron 3 Ultra on Nebius Token Factory decides whether the change touches this product, when, and how severe. It reports facts only, never a price. A verifier outside the model checks every quote against the extracted text. Then deterministic guardrails audit the verdict: a duty number must be stated by a backed quote (or be the difference of two stated rates), dates must be plausible, the action must fit the rule, the quotes must be about this product and not another heading or country on the same page, and repeats are dropped. Every adjustment is listed on the alert. The alert page also shows the source trail: the query, the domains, each result's score and date, which pages were read, and where the quotes matched.

**Reprice, deterministically.** Duty applies to the dutiable share of landed cost, the seller's current margin is held, and a cost increase can never produce a lower price. The web app and the extension render the same stored result with a one-sentence explanation.

**Stay current without a model.** The daily run refreshes every watched price with Tavily Extract alone, verifies nexus thresholds on the state revenue sites with Tavily Map and Extract, and only then runs due rules. A cost receipt shows the Tavily layer and the model layer side by side, and what routing saved.

The moment, as a judge can replay it:

1. Open the demo, click "Load demo shop". A wooden stacking toy from China, a USB desk lamp with a lithium battery, and an organic cotton tee from Vietnam are watched and their tariff rules run.
2. Open the lamp. The Section 301 alert quotes ustr.gov; the duty rises 12.5 points; the recommended price goes up to hold the margin, with the sentence that explains why. The evidence check shows what was backed, and the source trail shows the Tavily calls behind it.
3. Hover the same lamp on Amazon with the extension and press Alt+Shift+S: the HUD shows the same numbers from the same stored result.
4. Open Settings, click "Verify on the revenue sites" on the Watchlist: Texas and the other ship-to states read their thresholds from the revenue pages.
5. Dismiss an alert with a reason; it becomes a standing instruction the next check follows. Edit it or delete it on the product page.

### How we built it

In the order a check flows, each with the file that holds it:

- **Extension:** `extension/`, Manifest V3, vanilla TypeScript, Shadow DOM, focus-trapped `aria-modal` HUD. Shopify detection by `window.Shopify`, the checkout meta, or `/cdn/shop/` assets; the public `.json` endpoint is preferred over scraping; every extracted field carries a confidence. One-click connect from the web app's Settings through `postMessage`; price observations posted once an hour per product; id-based notifications.
- **Ingest:** `apps/web/src/lib/pipeline.ts` `ingestProduct`. Tavily Extract plus the page fields, then Nemotron 3 Nano with JSON schema output. The tariff heading is an enum over `hts-catalog.ts` (about 100 headings); a keyword matcher is the fallback and the cross-check. The general duty rate is read from hts.usitc.gov with Tavily Extract (`hts-rate.ts`).
- **Rules:** `rules-catalog.ts`. Tariff, product safety, sales tax, marketplace policy, each with official domains, a cadence the seller can change, pause and resume, and seeds labelled as seeds. Nexus seeds for 46 jurisdictions live in `nexus-thresholds.json`.
- **Check:** `checkRule`. Tavily Search (`include_domains` strict, `chunks_per_source`, `time_range`), Tavily Extract with the rule as the query, a content hash so unchanged sources skip the model, the rule's alert history and the price trend in the prompt, then Nemotron 3 Ultra with `RuleCheckSchema`. Scoped runs (due, all, one family) with live progress polled from a run record.
- **Verifier and guardrails:** `verifier.ts` (normalized substring, then 6-word shingles at 80 percent) and `sanity.ts` (rate in quotes, level versus change, dates, action fit, off-topic headings and countries, exclusion sentences, repeats, severity). Documented in `docs/GUARDRAILS.md`; measured by `scripts/eval.mts` on golden cases with traps.
- **Pricing:** `pricing.ts`, pure and unit-tested, bundled into the extension so both surfaces agree.
- **Prices and nexus without a model:** `prices.ts` (daily Tavily Extract refresh, price-change alerts) and `nexus-crawl.ts` (Tavily Map on the revenue domain, Extract of the best pages, a parser for the dollar and transaction tests with the quote, Crawl as the fallback).
- **Source trail and receipt:** `source-trail.ts` records every Tavily call behind an alert; `tavily-receipt.ts` aggregates them per rule family beside the model receipt.
- **Rule Forge:** `forge.ts` and `sandbox.ts`. Ultra writes a deterministic extractor, Nano writes the tests, a Token Factory sandbox runs them with networking off.
- **Store:** `db.ts`. One private Vercel Blob document per workspace, versions written create-only so writes are compare-and-swap; a file-backed store with canned model answers runs the whole product offline for development and judging without keys (labelled "demo mode" in the UI).
- **UI:** Next.js 14 with `@shopify/polaris` 13 and the token sheet in `docs/design/DESIGN.md`: Watchlist, Inspector with the price chart (range tabs, high and low, alert markers), alert pages with evidence first, rules grouped by product, cost receipt, settings.
- **Delivery:** a daily Vercel cron, the extension badge and notifications, Telegram when a bot token is set.

Engineering: `npm test` (unit tests for pricing, the catalog, the guardrails, overrides, charts, parsers), `npm run eval` (golden-case accuracy), `npm run smoke` (Playwright over every page with screenshots), `scripts/facts.mts` (one measured live cycle into `docs/FACTS.md`). `docs/not-built.md`, `docs/DECISIONS.md`, `docs/GUARDRAILS.md`, and `docs/TAVILY.md` say what is real, what is not, and why.

### How we meet each track

| Track | What the judges ask | What Shop Rules does |
|---|---|---|
| Personal AI Track | An always-on, private assistant with persistent memory, reusable skills, the tools and information you choose, and action across daily workflows | A daily watch loop plus on-demand checks; a workspace that remembers products, rules, alerts, price history, learned instructions, and forged checks; skills written from your dismissals; official domains you can see per rule; reprice and compliance steps drafted for approval; data in your own Blob store or Postgres |
| Best Use of Tavily | A functional, runtime call to the Tavily API as part of the solution | Search restricted to official domains and Extract on every check; Extract alone for the daily price refresh and for the general duty rate from hts.usitc.gov; Map, Extract, and Crawl on the state revenue sites to verify nexus thresholds; Search for competitor prices. Every alert shows its source trail (query, domains, scores, dates, pages read, passages matched) and the receipt shows the Tavily layer beside the model layer. The verifier works because the quotes come from text Tavily selected for the question. Details in `docs/TAVILY.md` |
| Coding and Agentic Engineering Track (alternative) | Agents that write, run, and test code in Token Factory | Rule Forge: Ultra writes the check, Nano writes the tests, a Token Factory sandbox runs them, Ultra revises; each forge keeps its code, tests, step log, and sandbox operation id |

Pick one track on Devpost. Recommendation: Personal AI Track with Best Use of Tavily; Rule Forge is the reason a judge from the Coding track still sees Token Factory used for execution, not only inference.

### Challenges we ran into

**Nano returned nothing.** With thinking on, a long listing prompt spent the whole completion budget on reasoning and `content` came back empty. Fixed with `chat_template_kwargs.enable_thinking=false` on structured calls and the structure moved into the prompt (`docs/DECISIONS.md`, D-3).

**Reads lagged writes.** One Blob file per workspace with ETag preconditions failed under read lag even with retries. Replaced by immutable versions resolved through the listing API, which was consistent in every probe (D-2).

**A blog in the evidence.** In prefer mode the origin-tariff rule surfaced a toy retailer's post next to the Federal Register. Tariff and safety rules now use strict official domains (D-4).

**Tests that never ran.** Nano named its tests `assert_*`; the harness only ran `test_*`. The harness now accepts both and the prompt insists on `test_`.

**Cron limits.** The Hobby plan refuses more than one scheduled run a day; the code is written for six hours. Judges run checks by hand from the product page, which is the demo path.

### What we got wrong

The first live demo cut a lamp's price after a duty increase: the model had been asked to compute the price and applied a target margin to the new cost on a product earning more than the target. That is why pricing is now arithmetic in `pricing.ts` with a unit test that a cost increase can never lower the price, and why the model reports facts only. The same demo classified a desk lamp as signalling apparatus at 92 percent confidence; the heading now comes from a catalog with a keyword cross-check. Rule Forge's sandbox step depends on the Token Factory project id being set; where it is not, the card says "Not run". The verifier checks presence, not meaning; the guardrails add coherence, and rejected claims and every adjustment stay visible. The cost saving from routing is modest on a single cycle (FACTS: 5 percent) because the decision step on Ultra dominates; the daily price refresh and the nexus verification need no model at all, which is where the saving grows.

### Accomplishments that we're proud of

- 10 of 12 claims backed by the extracted source text on the first measured check, the other 2 rejected and shown, in 18.3 seconds for 4 rules, with 5 of the 7 source domains on .gov (FACTS).
- One Nemotron Nano call classified a listing into origin, HTS candidate, and the rule set in 3.5 seconds (FACTS).
- A coding agent that produces a 61-line deterministic extractor and 3 tests for a tariff rule in 12.2 seconds (FACTS), with every step logged.

### What we learned

The hard part is not finding the regulation; it is refusing to repeat it unless the sentence is on the page. Routing is a product feature when the receipt is on screen. A sponsor tool earns its place by filling one need: Tavily found and chunked the official page, Token Factory decided and then ran the code.

### What's next

Shopify OAuth so "Apply reprice" changes the real price with a confirmation step; forged checks re-running on the schedule before the model is called; a resume cursor for the daily run; email digests; a Postgres backend with accounts.

### Try it

```bash
git clone https://github.com/anudeep-bonagiri/ShopRules.git
cd ShopRules
npm install
cp apps/web/.env.example apps/web/.env.local   # add NEBIUS_API_KEY, BLOB_READ_WRITE_TOKEN, CRON_SECRET; TAVILY_API_KEY optional
npm run dev                                      # without keys the app runs in demo mode: local store, canned model answers, labelled in the UI
npm test && npm run eval:offline && npm run smoke
```

---

## Built with (tags, up to 25)

nvidia-nemotron, nebius-token-factory, tavily, typescript, nextjs, react, shopify-polaris, vercel, vercel-blob, chrome-extension, esbuild, zod, openai-sdk, python

## Try it out links

- https://shop-rules.vercel.app
- https://github.com/anudeep-bonagiri/ShopRules

## Image gallery (3:2, 1800x1200)

1. Watchlist feed with three priority cards and the metric strip.
2. Product Inspector with the de minimis alert open and the evidence counter.
3. Alert page: claims with Backed labels, quotes, and source links.
4. Forge page: the write, test, run, revise timeline with model badges.
5. Chrome extension overlay on an Etsy listing.
6. Cost receipt.

## Video demo link

Under three minutes. Open on the extension overlay appearing over a listing, then the alert and its quote, then the forge timeline. Every spoken number is read off a screen element. No replayed footage.

---

## 3. Additional info

**Sponsor / Special Prizes (selected):** Personal AI Track; Best Use of Tavily
**Do not select:** Best Apps and Agents Track; Physical AI Track (and Coding and Agentic Engineering Track unless the team switches the primary track)

**Technology feedback:**

Nebius Token Factory: the OpenAI-compatible endpoint and `json_schema` output made Nemotron a drop-in behind the OpenAI SDK; one gotcha, thinking is on by default and can consume the whole completion budget on a long structured prompt, so `chat_template_kwargs.enable_thinking=false` belongs in every quickstart for structured output. The Sandboxes REST API is clean (spawn, poll, result) but the project id is a separate header that the key does not imply, and the error message should say where to find it.

NVIDIA Nemotron 3: Nano is fast and cheap enough to classify every listing and write tests; Ultra's rule decisions were specific and quoted correctly; both followed a JSON schema without retries once thinking was off.

Tavily: `include_domains` with strict and prefer modes plus `chunks_per_source` on Extract are what make a verifier practical; keyless mode let the app run before the key arrived. One wish: a way to ask Search for the most recent version of a government page (the `max_age_hours` flag exists but is refused on the free tier under load).

**AI tools used:** Nemotron 3 Nano and Ultra on Token Factory in the product; Claude Code during development.

**Did you implement a generative AI model or API, how and why:** Nemotron 3 Nano (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) and Nemotron 3 Ultra (`nvidia/Nemotron-3-Ultra-550b-a55b`) through Token Factory's chat completions with JSON schema output and thinking off. The box: Nano classifies and writes tests and instructions; Ultra decides and writes code; neither can create an alert without a quote the verifier finds in the extracted text; the generated code runs with networking off in a disposable sandbox; nothing changes a listing without the seller.

---

## Paste-time checklist

- Every number on the page appears in `docs/FACTS.md` or `docs/numbers_allowed.txt`. None typed.
- Every sponsor line describes something that runs at submit time.
- No em dashes.
- The first sentence a judge reads names the mechanism.
- "Not built" is said plainly, once, in "What we got wrong" and in `docs/not-built.md`.
- Every link answers a GET; the repo is public; `.env` files are ignored.
- The selected tracks equal `docs/tracks_allowed.txt`.
- Team emails, universities, and the IRL city (if attended) filled on the form.
