# Shop Rules

**Live demo:** https://shop-rules.vercel.app (click "Load demo shop", open a product, run a check). Chrome extension: `extension/shop-rules-extension.zip`.

An always-on compliance and pricing assistant for people who sell on Etsy, Shopify, and Amazon. It watches the tariff changes, product safety rules, and state sales-tax thresholds that touch your actual products, verifies every alert against the official source text, and drafts the reprice or compliance step for you to approve.

Built for the Nebius x NVIDIA Global AI Hackathon, Personal AI track. Every decision runs on NVIDIA Nemotron 3 through Nebius Token Factory, and every fact comes from the live web through Tavily.

- Web app: Next.js styled with Shopify's Polaris design system, so it feels like the admin you already use.
- Chrome extension: hover a listing, press Alt+Shift+S, see its stats (price and history, landed cost and margin, duty exposure, weekly drag), the rules that touch it, and the top alert with the reprice math; watch it in one click and get notified when its price or its rules change.
- Every number is arithmetic (`pricing.ts`), every model verdict passes a verifier and deterministic guardrails (`docs/GUARDRAILS.md`), and every alert shows the Tavily calls behind it (`docs/TAVILY.md`).
- Your data stays in your own workspace. Self-host with your own Vercel Blob or Postgres.

## How it works

1. **Read.** You paste a listing URL or press Alt+Shift+S on the page. The extension reads the page (Shopify stores answer their public `.json`; JSON-LD and Open Graph otherwise) and sends the fields along; Tavily Extract reads pasted URLs. Nemotron 3 Nano turns the text into a product profile: category, materials, origin, flags, and a four-digit tariff heading chosen from a curated catalog (`hts-catalog.ts`) with a keyword cross-check. The general duty rate is read from hts.usitc.gov with Tavily Extract. You can override any field; the classifier never writes over yours.
2. **Seed rules.** From the profile and your ship-to states, Shop Rules creates watch rules on official domains only: CBP, USTR, the Federal Register, trade.gov and the HTS for tariffs; CPSC, FDA, FTC, FCC and OEHHA for safety; each state's revenue site for economic nexus (46 jurisdictions seeded in `nexus-thresholds.json`); Seller Central, Etsy Help and Shopify Help for policy. Pause a rule or change its cadence on the Rules page.
3. **Watch.** Daily and on demand (due rules, every rule, or one family, with live progress) each rule runs Tavily Search restricted to its domains, then Tavily Extract with the rule as the query. A content hash skips the model when sources have not changed. The daily run also refreshes every watched price with Tavily Extract alone and verifies nexus thresholds on the revenue sites with Tavily Map and Extract.
4. **Decide.** Nemotron 3 Ultra reads the profile, the rule, your standing instructions, the rule's alert history and price trend, and the source excerpts, and reports facts: does this touch the product, how severe, effective when, the duty change in points, the steps. It never computes a price.
5. **Verify.** A verifier outside the model checks every quote against the extracted text. Deterministic guardrails then audit the verdict: numbers must be in a backed quote (a quote that moves a rate from 7.5 to 25 percent is 17.5 points even if the model wrote 25), dates must be plausible, the action must fit the rule, the quotes must be about this product and not another heading or country on the same page, repeats are dropped. Every adjustment is shown on the alert, with the source trail of Tavily calls.
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
| Storage | Vercel Blob, one private JSON document per workspace, versions written create-only so every write is compare-and-swap; a file-backed store runs the app offline in development; a Postgres schema is included for self-hosting |
| Extension | Chrome Manifest V3, vanilla TypeScript bundled with esbuild, Shadow DOM overlay |
| Delivery | Telegram bot (optional) and the extension badge |
| Scheduling | Vercel Cron daily hitting `/api/cron/check`: price refresh, nexus verification, then due rules |

## Run it locally

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
- `BLOB_READ_WRITE_TOKEN`: create a store with `vercel blob create-store shop-rules --access private` and run `vercel env pull`, or paste a token from the Vercel dashboard.
- `CRON_SECRET`: any random string.
- `TELEGRAM_BOT_TOKEN`: optional, from BotFather.

Then:

```bash
npm run dev
```

Without any keys the app starts in demo mode: a local file store under `apps/web/.sr-data`, Nemotron answers from recorded fixtures, Tavily results from recorded official excerpts. The Watchlist says so. Checks, the verifier, the guardrails, pricing, and the UI are the real code, so "Load demo shop" works offline.

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
vercel blob create-store shop-rules --access private   # answer yes to link it to the project
vercel env add NEBIUS_API_KEY production
vercel env add CRON_SECRET production
vercel env add APP_BASE_URL production                   # https://your-app.vercel.app
vercel --prod
```

Set the project's Root Directory to `apps/web`. The cron in `apps/web/vercel.json` runs the watch loop every six hours.

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
  src/lib/db.ts        Vercel Blob workspace store (compare-and-swap versions); blob.ts, offline.ts, canned.ts for demo mode
  src/lib/forge.ts     Rule Forge: write, test, run, revise
  src/lib/sandbox.ts   Token Factory Sandboxes client
  supabase/migration.sql    equivalent Postgres schema for self-hosting
extension/             Chrome extension (MV3); shop-rules-extension.zip is the packaged build
scripts/facts.mts      one measured live cycle, writes docs/FACTS.md
scripts/eval.mts       golden-case accuracy of the rule checker; scripts/smoke.mts walks every page
scripts/tavily-verify.mts  live nexus and HTS reads, writes docs/TAVILY-RUN.md
docs/                  FACTS, not-built, GUARDRAILS, TAVILY, EVAL, DEMO, CLAIMS_AUDIT, JUDGE_QA, DECISIONS, PROJECT_STATUS, VIDEO,
                       DEVPOST_FULL, api, competitors (REA teardown), design (token sheet and screens),
                       tavily-personal-ai-research (past Tavily prize winners and judge quotes)
```

## What is real and what is not

Everything on the public demo is a live call: Tavily, Nemotron on Token Factory, and the sandbox when `NEBIUS_PROJECT_ID` is set. Nothing is replayed. The measured numbers are in [docs/FACTS.md](docs/FACTS.md), what is not built is in [docs/not-built.md](docs/not-built.md), and every claim this README makes is audited in [docs/CLAIMS_AUDIT.md](docs/CLAIMS_AUDIT.md).

## What is honest about this build

- Thresholds and source lists in `rules-catalog.ts` are seeds. Every alert quotes the live page; nothing in an alert is hard-coded.
- Tariff headings come from a curated catalog the model picks from, cross-checked by keywords and labelled with confidence; the general duty rate is read from the official schedule when its page parses. Both are a starting point for a broker, not a classification.
- Prices are arithmetic. The model reports the duty change; `pricing.ts` computes the reprice and a unit test asserts a cost increase can never lower a price.
- Nexus thresholds are seeds until Tavily reads the revenue site and the parser finds the tests in the page text with the quote; the Watchlist labels each state either way.
- Model verdicts pass deterministic guardrails; what they changed is listed on the alert. Accuracy is measured on golden cases, not claimed.
- The verifier checks that a quote exists in the extracted text. It does not check that the quote means what the model says it means. That is why rejected claims stay visible, every source is one click away, and every alert carries its source trail.
- Some marketplaces block readers. The extension sends the fields from the page so ingestion still works; the demo seed does the same.
- Keyless Tavily is rate-limited. Add a key for anything beyond a demo.

## Feedback on the stack

Written up in the Devpost submission. Short version: Token Factory's OpenAI-compatible endpoint and `json_schema` output made Nemotron a drop-in; Nano is fast and cheap enough to classify every listing and write skills; Ultra is where the one hard decision belongs. Tavily's `include_domains` with `prefer` mode and `chunks_per_source` on Extract are what make a verifier practical: the quotes it checks come from text the API already selected for the question.

## License

MIT. See [LICENSE](LICENSE).
