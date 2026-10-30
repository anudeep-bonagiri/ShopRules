# Shop Rules

An always-on compliance and pricing assistant for people who sell on Etsy, Shopify, and Amazon. It watches the tariff changes, product safety rules, and state sales-tax thresholds that touch your actual products, verifies every alert against the official source text, and drafts the reprice or compliance step for you to approve.

Built for the Nebius x NVIDIA Global AI Hackathon, Personal AI track. Every decision runs on NVIDIA Nemotron 3 through Nebius Token Factory, and every fact comes from the live web through Tavily.

- Web app: Next.js styled with Shopify's Polaris design system, so it feels like the admin you already use.
- Chrome extension: hover a listing, press Alt+Shift+S, see the rules that touch it, open alerts, price history, and competitor prices, and watch it in one click.
- Your data stays in your own workspace. Self-host with your own Vercel Blob or Postgres.

## How it works

1. **Read.** You paste a listing URL or use the extension on the page. Tavily Extract reads the listing (the extension also sends the fields it scraped, so it works where marketplaces block readers). Nemotron 3 Nano turns the text into a product profile: category, materials, origin, whether it is for children, cosmetic, electronic, textile, and up to three HTS headings with confidence.
2. **Seed rules.** From the profile and your ship-to states, Shop Rules creates watch rules on official domains only: CBP, USTR, the Federal Register, trade.gov and the HTS for tariffs; CPSC, FDA, FTC, FCC and OEHHA for safety; each state's revenue site for economic nexus; Seller Central, Etsy Help and Shopify Help for policy.
3. **Watch.** On a schedule (and on demand) each rule runs Tavily Search restricted to its domains, then Tavily Extract with the rule as the query to pull the relevant chunks from the top pages. A content hash skips rules whose sources have not changed.
4. **Decide.** Nemotron 3 Ultra reads the product profile, the rule, your standing instructions, and the source excerpts, and decides: does this touch the product, how severe, effective when, and what to do (reprice with the price that keeps your margin, a compliance step, a tax registration, or a review).
5. **Verify.** A verifier outside the model checks every claim's quote against the extracted text. Claims whose quote is not in the source are rejected and shown as rejected. An alert only exists when at least one claim is backed.
6. **Act and learn.** Approve the step or dismiss the alert with a reason. The reason becomes a standing instruction (written by Nano) that future checks follow. A cost receipt shows which model did what and what sending everything to Ultra would have cost.

## Stack

| Piece | Choice |
|---|---|
| Models | NVIDIA Nemotron 3 Nano (extraction, classification, competitor parsing, skills) and Nemotron 3 Ultra (rule decisions) on Nebius Token Factory, OpenAI-compatible API with JSON schema output |
| Web access | Tavily Search (advanced depth, domain filters, chunks per source) and Tavily Extract (query-focused chunks); keyless mode as the fallback so a demo never dies on a missing key |
| App | Next.js 14, React 18, `@shopify/polaris` 13 |
| Storage | Vercel Blob, one private JSON document per workspace with ETag preconditions; a Postgres schema is included for self-hosting |
| Extension | Chrome Manifest V3, vanilla TypeScript bundled with esbuild, Shadow DOM overlay |
| Delivery | Telegram bot (optional) and the extension badge |
| Scheduling | Vercel Cron every 6 hours hitting `/api/cron/check` |

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
- `TAVILY_API_KEY`: optional. Without it, Search and Extract run in Tavily's free keyless mode.
- `BLOB_READ_WRITE_TOKEN`: create a store with `vercel blob create-store shop-rules --access private` and run `vercel env pull`, or paste a token from the Vercel dashboard.
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

Load `extension/dist` as an unpacked extension (chrome://extensions, Developer mode, Load unpacked), open the popup, and paste the URL and account token from the web app's Settings page. Details in [extension/README.md](extension/README.md).

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
  src/lib/db.ts        Vercel Blob workspace store
  supabase/migration.sql    equivalent Postgres schema for self-hosting
extension/             Chrome extension (MV3)
docs/                  research: past Tavily prize winners, competitor teardown, API
```

## What is honest about this build

- Thresholds and source lists in `rules-catalog.ts` are seeds. Every alert quotes the live page; nothing in an alert is hard-coded.
- HTS headings come from a language model. They are labeled with confidence and are a starting point for a broker, not a classification.
- The verifier checks that a quote exists in the extracted text. It does not check that the quote means what the model says it means. That is why rejected claims stay visible and why every source is one click away.
- Some marketplaces block readers. The extension sends the fields from the page so ingestion still works; the demo seed does the same.
- Keyless Tavily is rate-limited. Add a key for anything beyond a demo.

## Feedback on the stack

Written up in the Devpost submission. Short version: Token Factory's OpenAI-compatible endpoint and `json_schema` output made Nemotron a drop-in; Nano is fast and cheap enough to classify every listing and write skills; Ultra is where the one hard decision belongs. Tavily's `include_domains` with `prefer` mode and `chunks_per_source` on Extract are what make a verifier practical: the quotes it checks come from text the API already selected for the question.

## License

MIT. See [LICENSE](LICENSE).
