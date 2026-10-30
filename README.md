# Shop Rules

**Live demo:** https://shop-rules.vercel.app (click "Load demo shop", open a product, run a check). Chrome extension: the packaged build is at `extension/shop-rules-extension.zip`.

An always-on compliance and pricing assistant for people who sell on Etsy, Shopify, and Amazon. It watches the tariff changes, product safety rules, and state sales-tax thresholds that touch your actual products, verifies every alert against the official source text, and drafts the reprice or compliance step for you to approve.

Built for the Nebius x NVIDIA Global AI Hackathon, Personal AI track. Every decision runs on NVIDIA Nemotron 3 through Nebius Token Factory, and every fact comes from the live web through Tavily.

- Web app: Next.js styled with Shopify's Polaris design system, so it feels like the admin you already use.
- Chrome extension: hover a listing, press Alt+Shift+S, see the rules that touch it, open alerts, price history, and competitor prices, and watch it in one click.
- Your data stays in your own workspace. Self-host with your own Postgres (a free Supabase project works) or Vercel Blob.

## How it works

1. **Read.** You paste a listing URL or use the extension on the page. Tavily Extract reads the listing; when a marketplace answers with a bot wall, Tavily Search by listing URL supplies the indexed listing instead, and the extension also sends the fields it scraped. Nemotron 3 Nano turns the text into a product profile: category, materials, origin, whether it is for children, cosmetic, electronic, textile, and up to three HTS headings with confidence.
2. **Seed rules.** From the profile and your ship-to states, Shop Rules creates watch rules on official domains only: CBP, USTR, the Federal Register, trade.gov and the HTS for tariffs; CPSC, FDA, FTC, FCC and OEHHA for safety; each state's revenue site for economic nexus; Seller Central, Etsy Help and Shopify Help for policy.
3. **Watch.** On a schedule (and on demand) each rule runs Tavily Search restricted to its domains, then Tavily Extract with the rule as the query to pull the relevant chunks from the top pages. A content hash skips rules whose sources have not changed.
4. **Decide.** Nemotron 3 Ultra reads the product profile, the rule, your standing instructions, and the source excerpts, and decides: does this touch the product, how severe, effective when, and what to do (reprice with the price that keeps your margin, a compliance step, a tax registration, or a review).
5. **Verify.** A verifier outside the model checks every claim's quote against the extracted text: a normalized substring match, then six-word shingles at 80 percent with every number in the quote required verbatim, and elided quotes checked part by part. Claims whose quote is not in the source are rejected and shown as rejected. An alert only exists when at least one claim is backed. The verifier is scored on a planted fixture (`seed/generate.mts`) in every facts run.
6. **Act and learn.** Approve the step or dismiss the alert with a reason. The reason becomes a standing instruction (written by Nano) that future checks follow. A cost receipt shows which model did what and what sending everything to Ultra would have cost.
7. **Forge a check as code.** For any rule, Rule Forge has Nemotron 3 Ultra write a short Python extractor for the one fact the rule is about, Nemotron 3 Nano write tests from the facts the verifier already backed, and a Nebius Token Factory Sandbox run them with networking off. Ultra revises on failure, up to three times. The forge page shows every step, the code, the tests, and the sandbox output.

## Stack

| Piece | Choice |
|---|---|
| Models | NVIDIA Nemotron 3 Nano (extraction, classification, competitor parsing, skills, tests) and Nemotron 3 Ultra (rule decisions, check code) on Nebius Token Factory, OpenAI-compatible API with JSON schema output, thinking off for structured calls |
| Code execution | Nebius Token Factory Sandboxes (Contree REST): disposable containers, networking off, for the checks Rule Forge writes |
| Web access | Tavily Search (advanced depth, domain filters, chunks per source) and Tavily Extract (query-focused chunks); keyless mode as the fallback so a demo never dies on a missing key |
| App | Next.js 14, React 18, Shopify Polaris 13 |
| Storage | Postgres: one JSON document per workspace in a `workspaces` row, read in one query, written with an optimistic version check (tables in `apps/web/supabase/store.sql`). Vercel Blob remains an alternative backend behind `BLOB_READ_WRITE_TOKEN` |
| Extension | Chrome Manifest V3, vanilla TypeScript bundled with esbuild, Shadow DOM overlay |
| Delivery | Telegram bot (optional) and the extension badge |
| Scheduling | Vercel Cron (daily on the Hobby plan) hitting the check route in `apps/web/src/app/api/cron/check/route.ts` |

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
- `BLOB_READ_WRITE_TOKEN`: the alternative to `DATABASE_URL` (`vercel blob create-store shop-rules --access private`, then `vercel env pull`). Each read lists the workspace's versions, which Vercel bills as an advanced operation; on the Hobby plan the store is suspended past the monthly allowance, which is why Postgres is the default (D-12 in `docs/DECISIONS.md`).
- `CRON_SECRET`: any random string.
- `TELEGRAM_BOT_TOKEN`: optional, from BotFather.

Then:

```bash
npm run dev
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

Set the project's Root Directory to `apps/web`. The cron in `apps/web/vercel.json` runs the watch loop every six hours.

## Chrome extension

```bash
npm run build:ext
```

This writes the unpacked extension to the `dist` folder inside `extension/`. Load it in Chrome (chrome://extensions, Developer mode, Load unpacked), or unzip the packaged build at `extension/shop-rules-extension.zip` and load that folder. Open the popup and paste the URL and account token from the web app's Settings page. Details in [extension/README.md](extension/README.md).

## API

The extension and any script use the same JSON API as the app. See [docs/api.md](docs/api.md).

## Repository layout

```
apps/web/              Next.js app (Polaris UI, API routes, pipeline)
  src/lib/tavily.ts    Tavily Search, Extract, Map, Crawl client
  src/lib/nemotron.ts  Nemotron on Token Factory with JSON schema output and cost accounting
  src/lib/pipeline.ts  ingest, rule checks, compare, skills, Telegram
  src/lib/verifier.ts  quote-in-source verifier
  src/lib/rules-catalog.ts  rule families, official domains, state nexus seeds
  src/lib/db.ts        workspace store: Postgres rows (default) or Vercel Blob versions
  supabase/store.sql   the two Postgres tables the store uses
  src/lib/forge.ts     Rule Forge: write, test, run, revise
  src/lib/sandbox.ts   Token Factory Sandboxes client
  supabase/migration.sql    relational schema sketch for splitting the document later
extension/             Chrome extension (MV3); shop-rules-extension.zip is the packaged build
seed/generate.mts      deterministic verifier fixture with a hidden answer key (seed/fixtures)
scripts/facts.mts      one measured live cycle plus the verifier self-check; writes docs/FACTS.md and RESULTS.md
scripts/honesty.py     the honesty block in the README and RESULTS, and every "run of" timestamp
scripts/demo_up.sh     bare clone to the judging start state; full_run.sh the measured cycle; rehearse.sh the runbook with curl
docs/                  FACTS, RESULTS, TASKS (one need per sponsor), RUNBOOK, not-built, CLAIMS_AUDIT, JUDGE_QA,
                       DECISIONS, PROJECT_STATUS, VIDEO, DEVPOST_FULL, FACTS_CONTRACT, api, competitors (REA teardown),
                       design (token sheet and screens)
```

## What is real and what is simulated

Everything on the public demo is a live call: Tavily, Nemotron on Token Factory, and the sandbox when `NEBIUS_PROJECT_ID` is set. Nothing is replayed or simulated.

<!-- honesty:start -->
In the measured run of 2026-10-30T04:42:00Z, every Tavily call (12 in all, keyed mode) and every Nemotron call (7 in all) was live against the APIs; nothing was replayed, recorded, or stubbed.
The sandbox step did not run (Sandboxes are not configured: set NEBIUS_PROJECT_ID (Token Factory project settings) next to NEBIUS_API_KEY.); the forge card says the same.
The verifier backed 10 of 11 claims on the live check and rejected 1. On the planted fixture it rejected 8 of 10 misquotes and accepted 6 of 6 decoys; the misquotes it let through are named in docs/RESULTS.md.
<!-- honesty:end --> The "Load demo shop" button adds three listings whose page fields are supplied the way the extension supplies them; the checks it runs are real. The measured numbers are in [docs/FACTS.md](docs/FACTS.md), what is not built is in [docs/not-built.md](docs/not-built.md), and every claim this README makes is audited in [docs/CLAIMS_AUDIT.md](docs/CLAIMS_AUDIT.md).

## Not built

The full list is in [docs/not-built.md](docs/not-built.md). The short version: no store API (nothing is pushed back to a listing), no order data (nexus bars use figures you type), no login (a workspace token is the only access control), no Chrome Web Store listing, Map and Crawl wired but not in the default loop, and the sandbox step only runs when the Token Factory project id is set.

## What is honest about this build

- Thresholds and source lists in `apps/web/src/lib/rules-catalog.ts` are seeds. Every alert quotes the live page; nothing in an alert is hard-coded.
- HTS headings come from a language model. They are labeled with confidence and are a starting point for a broker, not a classification.
- The verifier checks that a quote exists in the extracted text. It does not check that the quote means what the model says it means. That is why rejected claims stay visible and why every source is one click away.
- Some marketplaces block readers. A bot wall is detected and dropped, Tavily Search by listing URL fills in from the index, and the extension sends the fields from the page; the demo seed does the same.
- Keyless Tavily is rate-limited. Add a key for anything beyond a demo.

## Feedback on the stack

Written up in the Devpost submission. Short version: Token Factory's OpenAI-compatible endpoint and `json_schema` output made Nemotron a drop-in; Nano is fast and cheap enough to classify every listing and write skills; Ultra is where the one hard decision belongs. Tavily's `include_domains` with `prefer` mode and `chunks_per_source` on Extract are what make a verifier practical: the quotes it checks come from text the API already selected for the question.

## License

MIT. See [LICENSE](LICENSE).
