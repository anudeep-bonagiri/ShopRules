# Shop Rules

**Live demo:** https://shop-rules.vercel.app (click "Load demo shop", open a product, run a check). Chrome extension: `extension/shop-rules-extension.zip`.

An always-on compliance and pricing assistant for people who sell on Etsy, Shopify, and Amazon. It watches the tariff changes, product safety rules, and state sales-tax thresholds that touch your actual products, verifies every alert against the official source text, and drafts the reprice or compliance step for you to approve.

Built for the Nebius x NVIDIA Global AI Hackathon, Personal AI track. Every decision runs on NVIDIA Nemotron 3 through Nebius Token Factory, and every fact comes from the live web through Tavily.

- Web app: Next.js styled with Shopify's Polaris design system, so it feels like the admin you already use.
- Chrome extension: hover a listing, press Alt+Shift+S, see its stats (price and history, landed cost and margin, duty exposure, weekly drag), the rules that touch it, and the top alert with the reprice math; watch it in one click and get notified when its price or its rules change.
- Every number is arithmetic (`pricing.ts`), every model verdict passes a verifier and deterministic guardrails (`docs/GUARDRAILS.md`), and every alert shows the Tavily calls behind it (`docs/TAVILY.md`).
- Your data stays in your own workspace. Self-host with your own Postgres (a free Supabase project works) or Vercel Blob.

## How it works

1. **Read.** You paste a listing URL or press Alt+Shift+S on the page. The extension reads the page (Shopify stores answer their public products JSON endpoint; JSON-LD and Open Graph otherwise) and sends the fields along; Tavily Extract reads pasted URLs, and when a marketplace answers with a bot wall, Tavily Search by listing URL supplies the indexed listing instead. Nemotron 3 Nano turns the text into a product profile: category, materials, origin, flags, and a four-digit tariff heading chosen from a curated catalog (`hts-catalog.ts`) with a keyword cross-check. The general duty rate is read from hts.usitc.gov with Tavily Extract. You can override any field; the classifier never writes over yours.
2. **Seed rules.** From the profile and your ship-to states, Shop Rules creates watch rules on official domains only: CBP, USTR, the Federal Register, trade.gov and the HTS for tariffs; CPSC, FDA, FTC, FCC and OEHHA for safety; each state's revenue site for economic nexus (46 jurisdictions seeded in `nexus-thresholds.json`); Seller Central, Etsy Help and Shopify Help for policy. Pause a rule or change its cadence on the Rules page.
3. **Watch.** Daily and on demand (due rules, every rule, or one family, with live progress) each rule runs Tavily Search restricted to its domains, then Tavily Extract with the rule as the query. A content hash skips the model when sources have not changed. The daily run also refreshes every watched price with Tavily Extract alone and verifies nexus thresholds on the revenue sites with Tavily Map and Extract.
4. **Decide.** Nemotron 3 Ultra reads the profile, the rule, your standing instructions, the rule's alert history and price trend, and the source excerpts, and reports facts: does this touch the product, how severe, effective when, the duty change in points, the steps. It never computes a price.
5. **Verify.** A verifier outside the model checks every quote against the extracted text. Deterministic guardrails then audit the verdict: numbers must be in a backed quote (a quote that moves a rate from one level to another is the difference of the two, even if the model wrote the new level), dates must be plausible, the action must fit the rule, the quotes must be about this product and not another heading or country on the same page, repeats are dropped. Every adjustment is shown on the alert, with the source trail of Tavily calls. The verifier's match is a normalized substring, then six-word shingles at 80 percent with every number in the quote required verbatim; elided quotes are checked part by part; it is scored on a planted fixture (`seed/generate.mts`) in every facts run.
6. **Reprice.** `pricing.ts` applies the duty to the dutiable share of landed cost, holds your current margin, absorbs tiny moves, and can never lower a price after a cost increase. The web app and the extension render the same stored result.
7. **Act and learn.** Approve the step or dismiss the alert with a reason. The reason becomes a standing instruction (written by Nano) that future checks follow; edit or delete it any time. A cost receipt shows the Tavily layer and the model layer side by side.
8. **Forge a check as code.** For any rule, Rule Forge has Ultra write a short Python extractor, Nano write tests from the backed facts, and a Nebius Token Factory Sandbox run them with networking off.

## Stack

| Piece | Choice |
|---|---|
| Models | NVIDIA Nemotron 3 Nano (extraction, classification, competitor parsing, skills, tests) and Nemotron 3 Ultra (rule decisions, check code) on Nebius Token Factory, OpenAI-compatible API with JSON schema output, thinking off for structured calls |
| Code execution | Nebius Token Factory Sandboxes (Contree REST): disposable containers, networking off, for the checks Rule Forge writes |
| Web access | Tavily Search (advanced depth, strict domain filters, chunks per source), Extract (query-focused chunks, the price refresh, the HTS schedule), Map and Crawl (state revenue sites for nexus); keyless mode as the fallback; recorded fixtures in demo mode |
| App | Next.js 14, React 18, `@shopify/polaris` 13 |
| Storage | Postgres: one JSON document per workspace in a `workspaces` row, read in one query, written back with a compare-and-swap version check (tables in `apps/web/supabase/store.sql`). Vercel Blob remains an alternative backend behind `BLOB_READ_WRITE_TOKEN` (versions written create-only, so writes are compare-and-swap); a file-backed store runs the app offline in development |
| Extension | Chrome Manifest V3, vanilla TypeScript bundled with esbuild, Shadow DOM overlay |
| Delivery | Telegram bot (optional) and the extension badge |
| Scheduling | Vercel Cron daily hitting the check route (`apps/web/src/app/api/cron/check/route.ts`): price refresh, nexus verification, then due rules |

## Run it

Requirements: Node 20 or newer, npm 10 or newer.

```bash
git clone https://github.com/anudeep-bonagiri/ShopRules.git
cd ShopRules
npm install
cp apps/web/.env.example apps/web/.env.local
```

Fill in `apps/web/.env.local`:

- `NEBIUS_API_KEY`: from [tokenfactory.nebius.com](https://tokenfactory.nebius.com). Hackathon code `NEBIUS-DEVPOST-GLOBAL26` adds credits.
- `NEBIUS_PROJECT_ID`: the Token Factory project id (Project settings). Needed for Rule Forge's sandbox runs; without it the forge still writes the code and tests and is labelled "Not run".
- `TAVILY_API_KEY`: optional. Without it, Search and Extract run in Tavily's free keyless mode.
- `DATABASE_URL`: a Postgres connection string (Supabase's transaction pooler on port 6543 works). Apply `apps/web/supabase/store.sql` to the database once. Preferred over Blob.
- `BLOB_READ_WRITE_TOKEN`: the alternative to `DATABASE_URL` (`vercel blob create-store shop-rules --access private`, then `vercel env pull`). Each read lists the workspace's versions, which Vercel bills as an advanced operation; on the Hobby plan the store is suspended past the monthly allowance, which is why Postgres is the default (D-17 in `docs/DECISIONS.md`).
- `CRON_SECRET`: any random string.
- `TELEGRAM_BOT_TOKEN`: optional, from BotFather.

Then:

```bash
npm run dev
```

Without any keys the app starts in demo mode: a local file store under the app's .sr-data folder, Nemotron answers from recorded fixtures, Tavily results from recorded official excerpts. The Watchlist says so. Checks, the verifier, the guardrails, pricing, and the UI are the real code, so "Load demo shop" works offline.

Checks that do not need keys:

```bash
npm test              # pricing, HTS catalog, guardrails, overrides, nexus, CSV, chart, price parsing
npm run eval:offline  # golden cases through the verifier and guardrails, writes docs/EVAL.offline.md
npm run smoke         # Playwright over every page in demo mode, screenshots in docs/design/shots/
npm run eval          # with keys: the same cases against live Nemotron, writes docs/EVAL.md
```

Open http://localhost:3000. Click "Load demo shop" on the home page to add three sample listings and run the first check, or paste any Etsy, Shopify, or Amazon listing URL.

## Deploy

```bash
vercel link
psql "$DATABASE_URL" -f apps/web/supabase/store.sql     # once, on your Postgres
vercel env add DATABASE_URL production
vercel env add NEBIUS_API_KEY production
vercel env add CRON_SECRET production
vercel env add APP_BASE_URL production                   # https://your-app.vercel.app
vercel --prod
```

Set the project's Root Directory to `apps/web`. The cron in `apps/web/vercel.json` runs the daily watch loop.

## Chrome extension

```bash
npm run build:ext
```

Load `extension/dist` as an unpacked extension (chrome://extensions, Developer mode, Load unpacked), then open the web app's Settings page and click "Connect Chrome extension". Pasting the URL and token into the popup still works. Details in [extension/README.md](extension/README.md).

## API

The extension and any script use the same JSON API as the app. See [docs/api.md](docs/api.md).

## Repository layout

```
apps/web/              Next.js app (Polaris UI, API routes, pipeline)
  src/lib/tavily.ts    Tavily Search, Extract, Map, Crawl client
  src/lib/nemotron.ts  Nemotron on Token Factory with JSON schema output and cost accounting
  src/lib/pipeline.ts  ingest, rule checks, compare, skills, Telegram
  src/lib/verifier.ts  quote-in-source verifier
  src/lib/sanity.ts    deterministic guardrails on every model verdict (docs/GUARDRAILS.md)
  src/lib/pricing.ts   reprice math, pure, shared with the extension
  src/lib/hts-catalog.ts  curated tariff headings and the keyword guard; hts-rate.ts reads hts.usitc.gov
  src/lib/rules-catalog.ts  rule families, official domains; nexus-thresholds.json, nexus.ts, nexus-crawl.ts
  src/lib/prices.ts    price refresh and price-change alerts; price-parse.ts; chart.ts
  src/lib/source-trail.ts  every Tavily call behind an alert; tavily-receipt.ts
  src/lib/db.ts        workspace store: Postgres rows (default) or Vercel Blob versions, both compare-and-swap; blob.ts, offline.ts, canned.ts for demo mode
  supabase/store.sql   the two Postgres tables the store uses
  src/lib/forge.ts     Rule Forge: write, test, run, revise
  src/lib/sandbox.ts   Token Factory Sandboxes client
  supabase/migration.sql    relational schema sketch for splitting the document later
extension/             Chrome extension (MV3); shop-rules-extension.zip is the packaged build
seed/generate.mts      deterministic verifier fixture with a hidden answer key (seed/fixtures)
scripts/facts.mts      one measured live cycle plus the verifier self-check; writes docs/FACTS.md and RESULTS.md
scripts/honesty.py     the honesty block in the README and RESULTS, and every "run of" timestamp
scripts/demo_up.sh     bare clone to the judging start state; full_run.sh the measured cycle; rehearse.sh the runbook with curl
scripts/eval.mts       golden-case accuracy of the rule checker; scripts/smoke.mts walks every page
scripts/tavily-verify.mts  live nexus and HTS reads, writes docs/TAVILY-RUN.md
docs/                  FACTS, RESULTS, TASKS (one need per sponsor), RUNBOOK, not-built, GUARDRAILS, TAVILY, EVAL, DEMO,
                       CLAIMS_AUDIT, JUDGE_QA, DECISIONS, PROJECT_STATUS, VIDEO, DEVPOST_FULL, FACTS_CONTRACT, api,
                       competitors (REA teardown), design (token sheet, screens and shots)
```

## What is real and what is simulated

Everything on the public demo is a live call: Tavily, Nemotron on Token Factory, and the sandbox when `NEBIUS_PROJECT_ID` is set; nothing there is replayed. Without keys, a development checkout runs in demo mode (a local file store, Nemotron answers from recorded fixtures, Tavily results from recorded official excerpts) and the Watchlist says so. The "Load demo shop" button adds three listings whose page fields are supplied the way the extension supplies them; the checks it runs are real. The measured numbers are in [docs/FACTS.md](docs/FACTS.md) and [docs/RESULTS.md](docs/RESULTS.md), what is not built is in [docs/not-built.md](docs/not-built.md), and every claim this README makes is audited in [docs/CLAIMS_AUDIT.md](docs/CLAIMS_AUDIT.md).

<!-- honesty:start -->
In the measured run of 2026-10-30T05:22:34Z, every Tavily call (13 in all, keyed mode) and every Nemotron call (7 in all) was live against the APIs; nothing was replayed, recorded, or stubbed.
The sandbox step did not run (Sandboxes are not configured: set NEBIUS_PROJECT_ID (Token Factory project settings) next to NEBIUS_API_KEY.); the forge card says the same.
The verifier backed 9 of 9 claims on the live check and rejected 0. On the planted fixture it rejected 8 of 10 misquotes and accepted 6 of 6 decoys; the misquotes it let through are named in docs/RESULTS.md.
<!-- honesty:end -->

## Not built

The full list is in [docs/not-built.md](docs/not-built.md). The short version: no store API (nothing is pushed back to a listing), no order API (nexus bars use a CSV you upload or figures you type), no login (a workspace token is the only access control), no Chrome Web Store listing, nexus thresholds are seeds until the revenue site is read, the sandbox step only runs when the Token Factory project id is set, and the verifier's fuzzy path has two known gaps that the planted fixture measures.

## What is honest about this build

- Thresholds and source lists in `rules-catalog.ts` are seeds. Every alert quotes the live page; nothing in an alert is hard-coded.
- Tariff headings come from a curated catalog the model picks from, cross-checked by keywords and labelled with confidence; the general duty rate is read from the official schedule when its page parses. Both are a starting point for a broker, not a classification.
- Prices are arithmetic. The model reports the duty change; `pricing.ts` computes the reprice and a unit test asserts a cost increase can never lower a price.
- Nexus thresholds are seeds until Tavily reads the revenue site and the parser finds the tests in the page text with the quote; the Watchlist labels each state either way.
- Model verdicts pass deterministic guardrails; what they changed is listed on the alert. Accuracy is measured on golden cases, not claimed.
- The verifier checks that a quote exists in the extracted text. It does not check that the quote means what the model says it means. That is why rejected claims stay visible, every source is one click away, and every alert carries its source trail.
- Some marketplaces block readers. A bot wall is detected and dropped, Tavily Search by listing URL fills in from the index, and the extension sends the fields from the page; the demo seed does the same.
- Keyless Tavily is rate-limited. Add a key for anything beyond a demo.

## Feedback on the stack

Written up in the Devpost submission. Short version: Token Factory's OpenAI-compatible endpoint and `json_schema` output made Nemotron a drop-in; Nano is fast and cheap enough to classify every listing and write skills; Ultra is where the one hard decision belongs. Tavily's `include_domains` with `prefer` mode and `chunks_per_source` on Extract are what make a verifier practical: the quotes it checks come from text the API already selected for the question.

## License

MIT. See [LICENSE](LICENSE).
