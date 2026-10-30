# Shop Rules: Devpost submission, every field

> Every number below is copied from `docs/FACTS.md` (run of 2026-10-30T05:22:34Z) or listed with a reason in `docs/numbers_allowed.txt`. Before the final paste: run `scripts/facts.mts` once more if the code changed, refresh the numbers marked FACTS, and replace the video line with the YouTube link.

---

## 1. Project overview

**Project name (60 max):**
Shop Rules

**Elevator pitch (200 max):**
The compliance clerk that quotes its sources. Shop Rules watches tariffs, product safety rules, and state nexus thresholds for each listing you sell, drops any alert it cannot quote, and drafts the reprice.

**Thumbnail (3:2):**
The product page with the de minimis alert open: the accent card, the evidence counter, and the "Draft reprice" block. Fallback: the Watchlist feed with one grouped product card. Export at 1800 by 1200 from the screenshots under `docs/design` or a fresh capture of https://shop-rules.vercel.app.

---

## 2. About the project (Markdown, the public page)

### Shop Rules: the compliance clerk that quotes its sources

> **Hover a listing, press Alt+Shift+S, watch it. Tavily reads the official pages. Nemotron 3 decides. A verifier and deterministic guardrails drop what the page does not say. The reprice math is arithmetic, not a model. You approve the step.**

| | |
|---|---|
| **Try it** | https://shop-rules.vercel.app (click "Load demo shop", open a product, run a check; about 40 seconds for the seed) |
| **Code** | https://github.com/anudeep-bonagiri/ShopRules |
| **Extension** | packaged build at `extension/shop-rules-extension.zip` in the repo, loads unpacked |

Numbers marked (FACTS) are copied from `docs/FACTS.md`, written by one measured run of 2026-10-30T05:22:34Z against the live APIs; the file, the script that wrote it, and the planted fixture it scores the verifier on are all in the repo.

### Inspiration

A solo seller on Etsy, Shopify, or Amazon is also the import compliance officer, the product safety officer, and the sales-tax department. Tariff rates on the goods they import changed repeatedly this year, de minimis treatment for low-value imports from China was suspended, and every state has its own nexus threshold. The information is public, on government pages, and nobody has time to read it for every product. The seller we built this for would rather be told "this rule touches this listing, here is the sentence, here is the new price" than be sent a newsletter.

### What it does

**The loop a seller lives in.** On any Amazon, Etsy, or Shopify listing, hover and press Alt+Shift+S. The extension reads the page (Shopify stores answer their public products JSON endpoint; JSON-LD and Open Graph otherwise) and shows a Product Stats HUD: price with its history, landed cost and margin, duty exposure with the tariff heading, weekly margin drag, and every rule that touches this product grouped as tariffs, safety, sales tax, and policy. One click watches it. From then on the seller is notified when its price moves past their threshold or when a rule changes, with a Chrome notification per alert and a badge count.

**Inspect and watch.** Watching reads the listing, classifies it with Nemotron 3 Nano (origin, materials, flags, and a four-digit tariff heading chosen from a curated catalog so the model cannot invent one), and seeds watch rules on official domains only: CBP, USTR, the Federal Register, CPSC, FDA, FTC, OEHHA, the revenue site of each ship-to state, and the marketplace's own policy pages. The seller can override any field (unit cost, origin, heading, materials) and the classifier never writes over it.

**Verify.** On every check, Tavily Search finds the official pages restricted to the rule's domains, Tavily Extract pulls the text, and Nemotron 3 Ultra on Nebius Token Factory decides whether the change touches this product, when, and how severe. It reports facts only, never a price. A verifier outside the model checks every quote against the extracted text. Then deterministic guardrails audit the verdict: a duty number must be stated by a backed quote (or be the difference of two stated rates), dates must be plausible, the action must fit the rule, the quotes must be about this product and not another heading or country on the same page, and repeats are dropped. Every adjustment is listed on the alert. The verifier's match requires every number in the quote verbatim and checks elided quotes part by part, and it is scored on a planted fixture with a hidden answer key in every facts run. The alert page also shows the source trail: the query, the domains, each result's score and date, which pages were read, and where the quotes matched.

**Reprice, deterministically.** Duty applies to the dutiable share of landed cost, the seller's current margin is held, and a cost increase can never produce a lower price. The web app and the extension render the same stored result with a one-sentence explanation.

**Stay current without a model.** The daily run refreshes every watched price with Tavily Extract alone, verifies nexus thresholds on the state revenue sites with Tavily Map and Extract, and only then runs due rules. A cost receipt shows the Tavily layer and the model layer side by side, and what routing saved.

The moment, as a judge can replay it:

1. Open the demo, click "Load demo shop". A wooden stacking toy from China, a USB desk lamp with a lithium battery, and an organic cotton tee from Vietnam are watched and their tariff rules run. The toy gets 12 rules (4 tariff, 3 safety, 4 tax, 1 policy) (FACTS).
2. Open the toy. The de minimis alert reads: "The $800 de minimis duty exemption is suspended for all shipments from China, so this $34 wooden toy now incurs full duties and fees on entry." Its evidence counter reads 4 of 4 backed, effective 2025-05-02. Across the four tariff rules of the first check: 9 claims proposed, 9 backed, none rejected, and the guardrails folded the 4 rule verdicts into 2 alerts; every source domain was a .gov site, 3 of 3 (FACTS).
3. Click a claim. The quote is the sentence from the official notice, and the source link opens it. A rejected claim stays on the card with its label, so you can see what the model proposed and the verifier refused.
4. Click "Forge a check". Nemotron 3 Ultra writes `check.py`, Nemotron 3 Nano writes the tests from the backed facts, a Token Factory sandbox runs them, and the forge page shows each step with its model and timing.
5. Hover the same toy or lamp on Amazon with the extension and press Alt+Shift+S: the HUD shows the same stored result, with price history, landed cost and margin, and the duty exposure.
6. On the Watchlist, click "Verify on the revenue sites": the ship-to states read their nexus thresholds from the revenue pages with Tavily Map and Extract, quote included.
7. Dismiss the Prop 65 alert with "we already print the warning". The next check carries that instruction; edit or delete it on the product page.

### How we built it

In the order a check flows, each with the file that holds it:

- **Extension:** `extension/`, Manifest V3, vanilla TypeScript, Shadow DOM, focus-trapped `aria-modal` HUD. Shopify detection by `window.Shopify`, the checkout meta, or `/cdn/shop/` assets; the public products JSON endpoint is preferred over scraping; every extracted field carries a confidence. One-click connect from the web app's Settings through `postMessage`; price observations posted once an hour per product; id-based notifications.
- **Ingest:** `apps/web/src/lib/pipeline.ts` `ingestProduct`. Tavily Extract plus the page fields; a bot wall is detected and dropped, and Tavily Search by listing URL restricted to the store supplies the indexed listing when the fetch fails. Then Nemotron 3 Nano with JSON schema output. The tariff heading is an enum over `hts-catalog.ts` (about 100 headings); a keyword matcher is the fallback and the cross-check. The general duty rate is read from hts.usitc.gov with Tavily Extract (`hts-rate.ts`).
- **Rules:** `rules-catalog.ts`. Tariff, product safety, sales tax, marketplace policy, each with official domains, a cadence the seller can change, pause and resume, and seeds labelled as seeds. Nexus seeds for 46 jurisdictions live in `nexus-thresholds.json`.
- **Check:** `checkRule`. Tavily Search (`include_domains` strict, `chunks_per_source`, `time_range`), Tavily Extract with the rule as the query, a content hash so unchanged sources skip the model, the rule's alert history and the price trend in the prompt, then Nemotron 3 Ultra with `RuleCheckSchema`. Scoped runs (due, all, one family) with live progress polled from a run record.
- **Verifier and guardrails:** `verifier.ts` (normalized substring, then six-word shingles at 80 percent with every number in the quote required verbatim, elided quotes checked part by part; scored on a planted fixture with a hidden answer key, `seed/generate.mts`, D-18) and `sanity.ts` (rate in quotes, level versus change, dates, action fit, off-topic headings and countries, exclusion sentences, repeats, severity). Documented in `docs/GUARDRAILS.md`; measured by `scripts/eval.mts` on golden cases with traps.
- **Pricing:** `pricing.ts`, pure and unit-tested, bundled into the extension so both surfaces agree.
- **Prices and nexus without a model:** `prices.ts` (daily Tavily Extract refresh, price-change alerts) and `nexus-crawl.ts` (Tavily Map on the revenue domain, Extract of the best pages, a parser for the dollar and transaction tests with the quote, Crawl as the fallback).
- **Source trail and receipt:** `source-trail.ts` records every Tavily call behind an alert; `tavily-receipt.ts` aggregates them per rule family beside the model receipt.
- **Rule Forge:** `forge.ts` and `sandbox.ts`. Ultra writes a deterministic extractor, Nano writes the tests, a Token Factory sandbox runs them with networking off.
- **Store:** `db.ts`. One JSON document per workspace in a Postgres row (Supabase), read in one query and written back with a compare-and-swap version check; Vercel Blob stays as the alternative backend with create-only versions; a file-backed store with canned model answers runs the whole product offline for development without keys (labelled "demo mode" in the UI). The public demo moved to Postgres the night before the deadline when the Blob store was suspended (D-17).
- **UI:** Next.js 14 with `@shopify/polaris` 13 and the token sheet in `docs/design/DESIGN.md`: Watchlist, Inspector with the price chart (range tabs, high and low, alert markers), alert pages with evidence first, rules grouped by product, cost receipt, settings.
- **Delivery:** a daily Vercel cron, the extension badge and notifications, Telegram when a bot token is set.

Also in the path: `docs/competitors.md`, a teardown of 6 competitor extensions with REA (Keepa, Camelizer, Honey, Helium 10, Jungle Scout, AMZScout); none of them handles tariffs, safety rules, or nexus, which is the gap.

Engineering: `npm test` (unit tests for pricing, the catalog, the guardrails, overrides, charts, parsers), `npm run eval` (golden-case accuracy), `npm run smoke` (Playwright over every page with screenshots), `scripts/facts.mts` (one measured live cycle plus the verifier self-check into `docs/FACTS.md` and `docs/RESULTS.md`), `scripts/honesty.py` (the honesty block and every run-of timestamp). `docs/not-built.md`, `docs/CLAIMS_AUDIT.md`, `docs/JUDGE_QA.md`, `docs/DECISIONS.md`, `docs/GUARDRAILS.md`, and `docs/TAVILY.md` say what is real, what is not, and why. CI typechecks and builds both packages, runs the unit tests, checks the fixture is deterministic and the honesty block matches the facts, runs gitleaks, and fails on an em dash in the outward prose.

### How we meet each track

| Track | What the judges ask | What Shop Rules does |
|---|---|---|
| Personal AI Track | An always-on, private assistant with persistent memory, reusable skills, the tools and information you choose, and action across daily workflows | A daily watch loop plus on-demand checks; a workspace that remembers products, rules, alerts, price history, learned instructions, and forged checks; skills written from your dismissals; official domains you can see per rule; reprice and compliance steps drafted for approval; data in your own Postgres or Blob store |
| Best Use of Tavily | A functional, runtime call to the Tavily API as part of the solution | Search restricted to official domains and Extract on every check; Extract alone for the daily price refresh and for the general duty rate from hts.usitc.gov; Map, Extract, and Crawl on the state revenue sites to verify nexus thresholds; Search for competitor prices. Every alert shows its source trail (query, domains, scores, dates, pages read, passages matched) and the receipt shows the Tavily layer beside the model layer. The verifier works because the quotes come from text Tavily selected for the question. Details in `docs/TAVILY.md` |

Rule Forge is also why a judge from the Coding and Agentic Engineering track sees Token Factory used for execution, not only inference: Ultra writes the check, Nano writes the tests, a Token Factory sandbox runs them, Ultra revises; each forge keeps its code, tests, step log, and sandbox operation id.

### Challenges we ran into

**Nano returned nothing.** With thinking on, a long listing prompt spent the whole completion budget on reasoning and `content` came back empty. Fixed with `chat_template_kwargs` `enable_thinking` false on structured calls and the structure moved into the prompt (D-3 in `docs/DECISIONS.md`).

**Reads lagged writes.** One Blob file per workspace with ETag preconditions failed under read lag even with retries. Replaced by immutable versions resolved through the listing API, which was consistent in every probe (D-2), and that listing is what sank the store next.

**The store got suspended.** Hours before the deadline Vercel Blob answered every read with "Your store is blocked": the versioned design listed blobs on each read, Vercel bills a list as an advanced operation, and the Hobby allowance ran out. The workspace store moved to Postgres (one row per workspace, optimistic version check) behind the same interface in `db.ts`; Blob stays as an alternative backend (D-17).

**A blog in the evidence.** In prefer mode the origin-tariff rule surfaced a toy retailer's post next to the Federal Register. Tariff and safety rules now use the restrict mode on official domains (D-4).

**Tests that never ran.** Nano named its tests with an assert prefix; the harness only ran functions named with a test prefix. The harness now accepts both and the prompt insists on the test prefix.

**Buttons that clipped.** The first feed design clipped its action buttons at a wide MacBook window and printed each action twice. The final pass groups alerts under one card per product and prints each action once.

**Cron limits.** The Hobby plan refuses more than one scheduled run a day; the code is written for six hours. Judges run checks by hand from the product page, which is the demo path.

### What we got wrong

The first live demo cut a lamp's price after a duty increase: the model had been asked to compute the price and applied a target margin to the new cost on a product earning more than the target. That is why pricing is now arithmetic in `pricing.ts` with a unit test that a cost increase can never lower the price, and why the model reports facts only. The same demo classified a desk lamp as signalling apparatus with high confidence; the heading now comes from a catalog with a keyword cross-check. Rule Forge's sandbox step depends on the Token Factory project id being set on the deployment; where it is not, the forge card says "Not run" and shows the code and tests anyway (FACTS records that status for the measured run). The verifier checks that a quote exists, not that it supports the claim, so a confidently misread sentence can pass; that is why rejected claims stay visible and every source is one click away. Scored on the planted fixture it lets 2 of 10 misquotes through: a negation inserted into a 42-word quote, and two non-adjacent sentences of one page joined as if contiguous (FACTS, `docs/RESULTS.md`). The cost saving from routing is modest on a single cycle, 9 percent (FACTS), because the decision step on Ultra dominates; it grows with the Nano-heavy parts (classification, compare, skills) a seller uses day to day. Prices are list prices from third-party trackers until replaced with the invoice. Tax and marketplace-policy rules use prefer mode, so a non-official page can appear in their evidence; the domain is printed on every evidence line.

### Accomplishments that we're proud of

- 9 of 9 claims backed by the extracted source text on the first measured check, in 16.3 seconds for 4 rules, with 3 of 3 source domains on .gov (FACTS).
- The verifier scored on a planted fixture with a hidden answer key: 8 of 10 planted misquotes rejected and 6 of 6 decoys accepted, with the 2 it let through named on the results page (FACTS).
- One Nemotron Nano call classified a listing into origin, HTS candidate, and the rule set in 2.6 seconds (FACTS).
- A coding agent that produces a 38-line deterministic extractor and 4 tests for a tariff rule in 8.2 seconds (FACTS), with every step logged, and a store that survived its own outage (D-17).

### What we learned

The hard part is not finding the regulation; it is refusing to repeat it unless the sentence is on the page. Routing is a product feature when the receipt is on screen. A sponsor tool earns its place by filling one need: Tavily found and chunked the official page, Token Factory decided and then ran the code.

### What's next

Shopify OAuth so "Apply reprice" changes the real price with a confirmation step; forged checks re-running on the schedule before the model is called; a resume cursor for the daily run; email digests; accounts on the Postgres store.

### Try it

```bash
git clone https://github.com/anudeep-bonagiri/ShopRules.git
cd ShopRules
npm install
cp apps/web/.env.example apps/web/.env.local   # add NEBIUS_API_KEY, DATABASE_URL (or BLOB_READ_WRITE_TOKEN), CRON_SECRET; TAVILY_API_KEY optional
npm run dev                                      # without keys the app runs in demo mode: local store, canned model answers, labelled in the UI
npm test && npm run eval:offline && npm run smoke
```

---

## Built with (tags, up to 25)

nvidia-nemotron, nebius-token-factory, nebius-sandboxes, tavily, typescript, nextjs, react, shopify-polaris, vercel, postgres, supabase, chrome-extension, esbuild, zod, openai-sdk, python

## Try it out links

- https://shop-rules.vercel.app
- https://github.com/anudeep-bonagiri/ShopRules

## Image gallery (3:2, 1800x1200)

1. Watchlist feed: one product card with its alert rows and the metric strip.
2. Product Inspector with the de minimis alert open and the evidence counter.
3. Alert page: claims with Backed labels, quotes, and source links.
4. Forge page: the write, test, run, revise timeline with model badges.
5. Chrome extension overlay on an Amazon listing.
6. Cost receipt.

## Video demo link

Under three minutes, public on YouTube. Script and shot list: https://github.com/anudeep-bonagiri/ShopRules/blob/main/docs/VIDEO.md. Open on the extension overlay appearing over a listing, then the alert and its quote, then the forge timeline. Every spoken number is read off a screen element. No replayed footage. Paste the YouTube URL on this line at submit time.

---

## 3. Additional info (this hackathon's form)

**Track (pick one):** Personal AI Track

**Sponsor / Special Prizes (selected):** Personal AI Track; Best Use of Tavily
**Do not select:** Best Apps and Agents Track; Physical AI Track; Coding and Agentic Engineering Track

**Working demo URL:** https://shop-rules.vercel.app

**Public code repository:** https://github.com/anudeep-bonagiri/ShopRules (MIT, license visible in the About box)

**Did the project exist before the submission period?** No. Everything was built during the submission period; the first commit is dated October 29, 2026.

**IRL Builders & Brews city:** leave blank unless a team member attended one, then name that city.

**Feedback on Nebius Token Factory, AI Cloud, and the NVIDIA models (required field):**

Nebius Token Factory: the OpenAI-compatible endpoint and JSON schema output made Nemotron a drop-in behind the OpenAI SDK; zero to hello world took one curl. One gotcha: thinking is on by default and can consume the whole completion budget on a long structured prompt, so `enable_thinking` false belongs in every quickstart for structured output. We would build with it again for the price-to-latency ratio on Nano. The Sandboxes REST API is clean (spawn, poll, result) but the project id is a separate header that the key does not imply, and the error message should say where to find it.

NVIDIA Nemotron 3: Nano is fast and cheap enough to classify every listing and write tests; Ultra's rule decisions were specific and quoted correctly; both followed a JSON schema without retries once thinking was off. What needs work: a documented way to ask Nano for compact JSON when the output is long, because one competitor-price call came back truncated before we raised the budget.

Tavily: `include_domains` with restrict and prefer modes plus `chunks_per_source` on Extract are what make a verifier practical; keyless mode let the app run before the key arrived. One wish: a way to ask Search for the most recent version of a government page on the free tier (the `max_age_hours` flag exists but can be refused under load).

**AI tools used:** Nemotron 3 Nano and Ultra on Token Factory in the product; Claude Code during development.

**Did you implement a generative AI model or API, how and why:** Nemotron 3 Nano (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) and Nemotron 3 Ultra (`nvidia/Nemotron-3-Ultra-550b-a55b`) through Token Factory's chat completions with JSON schema output and thinking off. The box: Nano classifies and writes tests and instructions; Ultra decides and writes code; neither can create an alert without a quote the verifier finds in the extracted text; the generated code runs with networking off in a disposable sandbox; nothing changes a listing without the seller.

**Team emails, universities:** anudeep.bonagiri@gmail.com (Anudeep Bonagiri, University of Texas at San Antonio); Sudeep (GitHub RedWhite-cmd) and Sujeeth (GitHub Rebootroma) add their own email and university on the form the morning of.

---

## Paste-time checklist

- Every number on the page appears in `docs/FACTS.md` or `docs/numbers_allowed.txt`. None typed.
- Every sponsor line describes something that runs at submit time.
- No em dashes.
- The first sentence a judge reads names the mechanism.
- "Not built" is said plainly, once, in "What we got wrong" and in `docs/not-built.md`.
- Every link answers a GET; the repo is public; `.env` files are ignored.
- The selected tracks equal `docs/tracks_allowed.txt`; the track dropdown says Personal AI Track.
- The video line carries the YouTube URL; the demo URL and repo URL are filled.
- Team emails, universities, and the IRL city (if attended) filled on the form.
