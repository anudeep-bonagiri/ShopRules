# Project status

Dated entries, newest first. Numbers come from `docs/FACTS.md`; none are typed here.

## 2026-10-30

- Rule Forge added: Ultra writes `check.py`, Nano writes `test_check.py`, a Token Factory sandbox runs the harness, Ultra revises up to three times. Backend, API, and facts script committed; UI landing on the product page and `/forge/[id]`.
- Storage moved to immutable versioned documents after ETag preconditions failed under read lag.
- Rule checks batched into one write and run three at a time; measured run in FACTS.
- Thinking disabled for structured Nemotron calls after an empty-content failure.
- Tariff and safety rules switched to strict official domains.
- Extension built and smoke-tested on fixtures; zipped under `extension/`.
- Web UI redesigned to the owner's token sheet and the two reference screens (Watchlist feed, Product Inspector HUD).

## 2026-10-29

- Research: every past "Best Use of Tavily" winner on Devpost, the judges' session transcript, Tavily's roadmap, the competitor set. `docs/tavily-personal-ai-research.md`.
- Competitor teardown with REA on six Chrome extensions. `docs/competitors.md`.
- App scaffolded: Next.js 14, Polaris 13, Tavily client, Nemotron client, verifier, rule catalog, Blob store, API routes, pages. First deploy attempt blocked by the cron schedule (Hobby plan), fixed to daily.
- Ingest hardened after a tester saw products named "www.etsy.com" and "www.amazon.com": a bot wall is detected and dropped, Tavily Search by listing URL (restricted to the store, same listing id or ASIN) supplies the indexed listing when the fetch fails, titles on Etsy and Amazon come from the page title with the Amazon keyword tail cut, and a store homepage or a URL without a scheme is handled with a message that names the listing path shapes (D-16). Verified on a local server: one Etsy listing, two Amazon listings, two homepages.
- Facts regenerated on the final pipeline; the facts header now prints seconds next to milliseconds so the page can quote either.
- Outage: at 03:25Z the Vercel Blob store was suspended under the Hobby usage threshold; production answered every request with "Vercel Blob: Failed to fetch blob: 403 Forbidden". Replaced the store with Postgres on a new free Supabase project behind the same interface (D-17), redeployed, and verified the public demo. Old workspaces were unreadable and are gone.

## 2026-10-30 (UTC): verify pass before the freeze

Automated pass (`check_submission.py`, facts header 2026-10-30T03:45:54Z), observed output:

- PASS allow: every entry carries a reason
- PASS numbers: DEVPOST_FULL.md: 26 numbers, 9 allowed with a reason, 0 untraced, short counts to eyeball: ['40', '65', '29']; README.md: 13 numbers, 5 allowed with a reason, 0 untraced; VIDEO.md: 6 numbers, 1 allowed with a reason, 0 untraced, short counts to eyeball: ['65']
- PASS live-claims: skipped: the facts files carry none of the three sentences this check reads (see FACTS_CONTRACT.md)
- PASS facts-fresh: facts headers {'FACTS.md': '2026-10-30T03:45:54Z'}; every quoted timestamp matches
- PASS dashes: none
- PASS placeholders: none
- PASS live-wording: 15 line(s); read each against the label on the card it describes: ['DEVPOST_FULL.md:59', 'README.md:3', 'README.md:7', 'README.md:106', 'README.md:114', 'README.md:122', 'VIDEO.md:13', 'VIDEO.md:17', 'VIDEO.md:13', 'VIDEO.md:17', 'README.md:3', 'README.md:7']
- PASS autonomous-wording: 2 line(s); a refusal count or the word refuses must sit in the same paragraph: ['VIDEO.md:17', 'VIDEO.md:17']
- PASS links: 4 link(s) answered
- PASS tracks: one Sponsor line equal to the allowed list; do-not-select list present and disjoint
- PASS identifiers: 12 backticked identifier(s) on the page, all found in .
- PASS readme: all sections present once; every backticked path exists
- PASS repo: PUBLIC https://github.com/anudeep-bonagiri/ShopRules
- PASS secrets: clean

Manual checks, observed:

- PASS production store: `GET /api/health` on https://shop-rules.vercel.app returns `store: postgres`, `tavily_mode: keyed`; `GET /api/account` creates a workspace; `GET /api/products` returns an empty list on a fresh cookie.
- PASS store smoke on the Postgres backend (local script): create, idempotent re-create, settings update, token lookup, list ids, delete; create 783 ms, list 90 ms.
- PASS ingest on live listings (local server): one Etsy listing titled from the page, two Amazon listings titled from the page with the keyword tail cut, two store homepages refused with the listing-path message.
- PASS forge tests: the measured run shows 4 test functions after the retry-then-wrap guard (the run before it showed 0, with assertions under comment headers).
- NOT RUN sandbox: `NEBIUS_PROJECT_ID` is still unset, so the forge card says "Not run" and FACTS records status unrun.
- NOT RUN video: no cut exists yet; `docs/VIDEO.md` is the script. The Devpost video line carries the script link until the YouTube URL exists.
- NOT RUN cold start on a fresh clone: the measured cycle ran from this checkout; the cold-start script needs the Postgres URL in the clone's env.

## 2026-10-30 (UTC): /devpost setup applied to this repo, verify rerun

Scaffolded and adapted: `docs/TASKS.md` (one need per sponsor), `seed/generate.mts` plus `seed/fixtures` (deterministic verifier fixture with a hidden answer key, byte-identical on two runs), `scripts/facts.mts` now scores the verifier and writes `docs/RESULTS.md` and deletes its workspace, `scripts/honesty.py` (the honesty block and every run-of timestamp), `scripts/demo_up.sh`, `scripts/full_run.sh`, `scripts/rehearse.sh`, `docs/RUNBOOK.md`, `docs/FACTS_CONTRACT.md`, `docs/RESULTS_HISTORY.md`, CI steps for fixture determinism and the honesty diff, `DELETE /api/account`. Verifier hardened from the first fixture score: fuzzy matches must carry every number, elided quotes are checked part by part (D-18).

Automated pass (`check_submission.py`, facts header 2026-10-30T04:42:00Z), observed output:

- PASS allow: every entry carries a reason
- PASS numbers: DEVPOST_FULL.md: 29 numbers, 6 allowed with a reason, 0 untraced, short counts to eyeball: ['40', '65', '29']; README.md: 17 numbers, 3 allowed with a reason, 0 untraced; VIDEO.md: 6 numbers, 1 allowed with a reason, 0 untraced, short counts to eyeball: ['65']; RUNBOOK.md: 12 numbers, 2 allowed with a reason, 0 untraced, short counts to eyeball: ['43', '65']
- PASS live-claims: skipped: the facts files carry none of the three sentences this check reads (see FACTS_CONTRACT.md)
- PASS facts-fresh: facts headers {'FACTS.md': '2026-10-30T04:42:00Z', 'RESULTS.md': '2026-10-30T04:42:00Z'}; every quoted timestamp matches
- PASS dashes: none
- PASS placeholders: none
- PASS live-wording: 27 line(s); read each against the label on the card it describes: ['DEVPOST_FULL.md:59', 'README.md:3', 'README.md:7', 'README.md:107', 'README.md:117', 'README.md:120', 'README.md:122', 'README.md:131', 'VIDEO.md:13', 'VIDEO.md:17', 'RUNBOOK.md:4', 'RUNBOOK.md:5']
- PASS autonomous-wording: 2 line(s); a refusal count or the word refuses must sit in the same paragraph: ['VIDEO.md:17', 'VIDEO.md:17']
- PASS links: 4 link(s) answered
- PASS tracks: one Sponsor line equal to the allowed list; do-not-select list present and disjoint
- PASS identifiers: 12 backticked identifier(s) on the page, all found in .
- PASS readme: all sections present once; every backticked path exists
- PASS repo: PUBLIC https://github.com/anudeep-bonagiri/ShopRules
- PASS secrets: clean

Observed on the public demo with `BASE=https://shop-rules.vercel.app scripts/rehearse.sh`: health ok; fresh workspace; Load demo shop 37 s, 3 products; the toy 3 open alerts (de minimis 5/5 backed, two Section 301 alerts 3/3 backed); Run check now 14 s, 4 rules; forge 10 s, status unrun (no sandbox project id), 4 steps; receipt 6 runs; workspace deleted; 64 s in all.
Verifier fixture: 8 of 10 planted misquotes rejected (let through: negated_long, stitched_same_source), 6 of 6 decoys accepted; both gaps are in `docs/not-built.md`.

## Tried and rejected

| Tried | Why rejected | Replaced by |
|---|---|---|
| Supabase (two MCP connectors) | Both connectors unauthorized from this environment | Vercel Blob (D-2) |
| InsForge CLI | Session token expired; browser login needed | Vercel Blob (D-2) |
| One Blob file per workspace with `ifMatch` ETag | Reads lagged writes by seconds; preconditions failed even with retries | Versioned files resolved through `list()` |
| Nemotron thinking on for classification | Empty content when reasoning consumed the budget | Thinking off, structure in the prompt (D-3) |
| Prefer-mode domains for the origin tariff rule | Pulled a retailer blog and a filament shop into the evidence | Strict official domains (D-4) |
| Six-hour cron | Hobby plan refuses more than daily | Daily cron plus manual runs (D-8) |
| Per-rule writes during a check | Conflicts between parallel rules | One batched write (D-6) |
| `assert_*` test names from Nano | The harness only ran `test_*` | Harness accepts `test_`, `assert_`, `check_`; prompt insists on `test_` |
| Nano's title for an Amazon listing | Picked a related product's name out of a 160 KB page | Page title on Etsy and Amazon, classifier elsewhere (D-16) |
| Vercel Blob as the workspace store | Suspended under the Hobby usage threshold after a day of testing; every read lists versions, an advanced operation | Postgres document store on Supabase (D-17); Blob kept as an alternative backend |
