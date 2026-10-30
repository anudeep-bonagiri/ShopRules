# Claims audit

Every claim the Devpost page or README makes, where it is made, what backs it, and the verdict. Numbers live in `docs/FACTS.md` and are not retyped here.

| Claim | Where | Backing | Verdict |
|---|---|---|---|
| Every alert quotes the official source and a verifier drops unbacked claims | README, Devpost, alert page | `apps/web/src/lib/verifier.ts` (normalized substring and shingle match); FACTS "First check" claims proposed, backed, rejected | Holds. The verifier checks presence, not meaning (see not-built.md) |
| Watch rules search official domains only | README, rules page | `apps/web/src/lib/rules-catalog.ts`: tariff and Section 301 rules use strict domain mode on cbp.gov, ustr.gov, federalregister.gov, trade.gov, hts.usitc.gov, whitehouse.gov; safety rules strict on cpsc.gov, fda.gov, ftc.gov, oehha.ca.gov; de minimis, HTS, tax, and policy rules use prefer mode | Holds for strict rules. Prefer-mode rules can surface a non-official page when the official one lacks the query; FACTS lists the domains actually read |
| Runs on Nebius Token Factory with NVIDIA Nemotron 3 | README, Devpost | `apps/web/src/lib/nemotron.ts` base URL `api.tokenfactory.nebius.com`, model ids in FACTS "Setup"; every ingest, check, compare, skill, and forge call goes through it | Holds |
| Makes a functional runtime call to the Tavily API | Devpost (Best Use of Tavily eligibility) | `apps/web/src/lib/tavily.ts`; FACTS counts Tavily calls per stage; Search and Extract on every check | Holds |
| Nano for fast calls, Ultra for the decision; routing saves money versus all-Ultra | README, receipt page, Devpost | `apps/web/src/lib/pipeline.ts` tier choices; receipt computes the all-Ultra baseline from the same tokens; FACTS "Cost" | Holds as an estimate. Prices are list prices from third-party trackers until replaced with the invoice |
| Rule Forge writes, runs, and tests code in a Token Factory sandbox | Devpost, product page, forge page | `apps/web/src/lib/forge.ts`, `apps/web/src/lib/sandbox.ts` (Contree REST); FACTS "Rule Forge" status | Holds when `NEBIUS_PROJECT_ID` is set. Otherwise the forge is labelled "Not run" on the card and in FACTS |
| A dismissal with a reason becomes a standing instruction future checks follow | README, alert page | `skillFromDismissal` in pipeline.ts; skills are injected into the Ultra prompt in `checkRule` | Holds |
| The extension works on Etsy, Shopify, and Amazon listing pages | README, extension README | `extension/src/extract.ts` with JSON-LD, Open Graph, and per-site selectors; Playwright smoke test on fixture pages with site-like markup | Holds on fixtures. Not run against the live marketplaces in an automated test |
| Looks like Shopify admin | README | `@shopify/polaris` 13 components plus the owner's token sheet `docs/design/DESIGN.md` | Holds |
| Data stays in your own workspace | README, settings page | One private Vercel Blob document per workspace, versioned; `apps/web/src/lib/db.ts` | Holds for the deployment owner. A workspace token is the only access control (see not-built.md) |
| Six competitor extensions were torn down with REA | docs/competitors.md | `scratchpad` evidence summarized in competitors.md with file paths; REA ran on four of six, two timed out and were read by hand | Holds with that caveat, stated in the doc |
| Alerts arrive on Telegram | README | `notifyTelegram` in pipeline.ts | Holds only when `TELEGRAM_BOT_TOKEN` is set; not set on the public demo |
