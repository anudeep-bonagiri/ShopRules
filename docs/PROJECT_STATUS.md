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
