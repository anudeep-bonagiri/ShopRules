# How Shop Rules uses Tavily

Written for the Best Use of Tavily judges. Shop Rules watches tariff, product-safety, sales-tax nexus, and marketplace-policy changes for small sellers on Etsy, Shopify, and Amazon. Every fact a seller sees was read from an official page by Tavily. The model (NVIDIA Nemotron 3 on Nebius) only decides whether a passage Tavily already fetched touches a product; it never fetches, never remembers, and is skipped entirely wherever a deterministic parser can do the job.

## What each Tavily API does here

| API | Where | Why this one |
| --- | --- | --- |
| **Search** (`search_depth: advanced`, `include_domains_mode: restrict`) | `apps/web/src/lib/pipeline.ts`, `checkRule` | Each watch rule names the official domains it trusts (cbp.gov, ustr.gov, federalregister.gov, cpsc.gov, fda.gov, the state revenue site). Restrict mode means a retailer blog or a news rewrite can never become evidence. `time_range: year` keeps the loop on current actions; older pages are background. |
| **Extract** (markdown, `query` + `chunks_per_source`) | `checkRule`, right after Search | The verifier (`verifier.ts`) only keeps a model claim when its quote appears in text Tavily extracted from that page. Extract gives the full passage, so a quote cannot be stitched from a snippet. The deterministic guardrails (`sanity.ts`) read each quote in its surrounding Extract passage to confirm the page is about this product's heading and origin. |
| **Extract** (daily price refresh, no model) | `apps/web/src/lib/prices.ts`, `refreshPrices` | Every watched listing is re-read once a day; `price-parse.ts` reads JSON-LD, OpenGraph, or the page markup, and a point is stored when the price moved. Shopify stores answer their public `.json` endpoint directly. A price-change alert needs no model at all. |
| **Map** (`instructions`, `max_depth: 2`) | `apps/web/src/lib/nexus-crawl.ts`, `verifyStateThreshold` | A state revenue site has hundreds of pages; Map with instructions ("remote sellers, economic nexus, marketplace facilitators") returns the handful that matter. A pure scorer (`pickCandidateUrls`) ranks them by path and keeps them on the revenue domain. |
| **Crawl** (fallback, `max_depth: 1`) | same file | When Map returns nothing for a site (or the key is missing), Crawl from the seed URL reads the page and its neighbours in one call. |
| **Extract** (schedule pages) | `apps/web/src/lib/hts-rate.ts`, `fetchHtsRate` | The general duty rate for a product's tariff heading is read from hts.usitc.gov and parsed deterministically (`parseHtsRates`), with the exact schedule line kept as the quote. No model guesses a rate. |
| **Search** (competitor compare) | `apps/web/src/lib/pipeline.ts`, `compareListings` | Finds the same product on other marketplaces; results are cached per product for 24 hours so the paid call runs once a day at most. |

Keyless mode: without `TAVILY_API_KEY` Search and Extract still run in Tavily's keyless mode, so a fresh deploy never dies on a missing key; Map and Crawl need the key and the code says so. A canned offline mode exists for local demos and tests and is labelled as such in the UI.

## Deterministic vs model-assisted

| Step | Who decides | Model involved |
| --- | --- | --- |
| Which pages to read | Tavily Search / Map / Crawl with strict domains | no |
| Whether a quote is real | Verifier over Extract text | no |
| Nexus threshold ($, transactions, or/and, period) | `parseThresholdFromText` over Extract or Crawl text | no |
| General duty rate for a heading | `parseHtsRates` over Extract text | no |
| Listing price today | `price-parse.ts` over Extract text | no |
| Does this notice touch this product | Nemotron Ultra reads the Extract passages | yes, then audited by `sanity.ts` |
| Classification of a new listing | Nemotron Nano, heading restricted to a curated catalog | yes, cross-checked by keywords |
| Reprice math | `pricing.ts` | no |

A forged check (Rule Forge) that already passed runs in a sandbox on the fresh Tavily text first; the model is called only when it finds nothing. The receipt names which path ran.

## What the seller sees

- **Source trail on every alert** (`source-trail.ts`): the query, the allowed domains and mode, every result Tavily returned with its score and publish date and whether it was chosen, which pages were extracted and how many characters came back, the exact passage spans that backed each claim, and whether a model was consulted. The caption reads like "4 official pages searched on ustr.gov and cbp.gov, 3 extracted, 2 passages matched, model consulted".
- **Nexus line per state**: "Texas: $500,000 over the prior 12 months, verified 2026-10-30 from comptroller.texas.gov, matches the seed" or, honestly, "seed value, not verified (no sentence on the pages states a dollar threshold)".
- **Duty rate line per product**: "9405, Luminaires and lighting fittings: general duty 3.9%, column 2 35% (line 9405.20.60), read from hts.usitc.gov on 2026-10-30".
- **Tavily receipt** (`tavily-receipt.ts`) next to the model receipt: calls and credits per rule family, how many alerts needed no model, how many runs were Extract-only price refreshes, how many Map and Crawl calls walked revenue sites.

## Honest about seeds vs verified

Nexus thresholds ship as seeds (`nexus-thresholds.json`, labelled with an `as_of` date). A state's row is called verified only when `verifyStateThreshold` parsed a dollar threshold from a page on that state's revenue domain, and the UI shows the date and domain. HTS rates are never seeded; the product shows a rate only after it was read from hts.usitc.gov. Tariff and safety alerts exist only when a quote was found in Extract text.

## Numbers

From the measured live run (`scripts/facts.mts`, `scripts/tavily-verify.mts`):

- States verified by Map or Crawl plus Extract: `<from FACTS>` of `<from FACTS>` attempted, `<from FACTS>` matching the seed, `<from FACTS>` differing (listed in `docs/TAVILY-RUN.md`).
- Headings whose general duty rate was read from hts.usitc.gov: `<from FACTS>`.
- One full product cycle: `<from FACTS>` Tavily calls, `<from FACTS>` credits, `<from FACTS>` model calls, `<from FACTS>` USD model cost.
- Share of runs with no model call (price refreshes, unchanged sources, forged checks): `<from FACTS>`.
- Alerts raised without a model: `<from FACTS>`.
