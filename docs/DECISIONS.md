# Decisions

Each entry: the decision, why, the consequence.

**D-1. Polaris React for the admin.** The product is for people who live in Shopify admin; Polaris is Shopify's own component library and the owner's token sheet (`docs/design/DESIGN.md`) is Polaris-derived. Consequence: the React package is deprecated upstream in favour of web components; it still builds and renders. We extend it with `stitch.tsx` for the feed cards and the inspector.

**D-2. Vercel Blob as the store, one versioned document per workspace.** The team's Supabase and InsForge credentials were not available from this environment on the night; Blob needed no extra account and ships with the deploy. Consequence: no SQL, no multi-user auth. Overwriting one file with ETag preconditions lost writes because reads lagged, so every write is a new immutable version and the newest is found through the listing API (`db.ts`). The Postgres schema is kept in `apps/web/supabase/migration.sql` for self-hosting.

**D-3. Thinking off for Nemotron structured calls.** Nano returned empty content on a long classification prompt because reasoning consumed the completion budget. `chat_template_kwargs.enable_thinking=false` fixed it and cut latency. Consequence: the prompts carry the reasoning structure; `NEMOTRON_ULTRA_THINKING=1` is there for the decision step.

**D-4. Strict official domains for tariff and safety rules.** In prefer mode the origin-tariff rule surfaced a toy-retailer blog and a filament shop. Strict mode on cbp.gov, ustr.gov, federalregister.gov, trade.gov, hts.usitc.gov, whitehouse.gov, cpsc.gov, fda.gov, ftc.gov, oehha.ca.gov keeps the evidence official. Consequence: some rules return no results on some days; that is reported as "nothing new", not padded.

**D-5. The verifier checks presence only.** A quote must appear in the extracted text (normalized substring, then 6-word shingles at 80%). It does not judge meaning. Consequence: rejected claims are shown, not hidden, and alerts carry "might apply" when the model is unsure.

**D-6. One workspace write per check run.** Rules run three at a time and their bookkeeping, new alerts, and the product's last-checked stamp land in one write (`applyCheckBatch`). Consequence: fewer conflicts, and a check that fails midway loses nothing.

**D-7. Rule Forge runs on Token Factory Sandboxes with networking off.** The generated code reads the Tavily text we already fetched; it never fetches. Consequence: deterministic, cheap, and a passing check can be re-run without a model. Without `NEBIUS_PROJECT_ID` the forge is labelled "Not run".

**D-8. Daily cron on the public deployment.** The Hobby plan allows one run a day; the code is written for six hours. Consequence: judges run checks by hand from the product page, which is the demo path anyway.

**D-9. The extension sends page fields with the URL.** Marketplaces block readers; the extension already has the DOM. Consequence: watching from the page works even when Tavily Extract gets nothing, and the demo seed uses the same path.

**D-10. No em dashes in prose, including model output shown to sellers.** `plain()` in `pipeline.ts` replaces them in headlines, claims, and steps. Consequence: one less thing that reads as machine-written.

**D-11. A bot wall is not a listing.** Etsy and Amazon answer some fetches with a challenge page whose title is the bare hostname. `looksBlocked()` in `pipeline.ts` drops that text, `indexedListing()` asks Tavily Search for the listing URL restricted to the store and keeps only the result with the same listing id, ASIN, or product handle, and `cleanTitle()` refuses a hostname or a store name as a product title. On Etsy and Amazon the page title is the listing title, so it outranks the classifier's name; on a Shopify store it carries the shop name, so the classifier wins. A store homepage is refused with the listing path shapes in the message. Consequence: no product is ever called "www.etsy.com", and a blocked fetch still yields the listing from Tavily's index.

**D-12. Postgres is the store; Blob is the alternative backend.** At 03:25Z on 2026-10-30 the Vercel Blob store was suspended ("Your store is blocked"; creating another store failed with "usage threshold limit is reached") after a day of testing. Every read of a workspace listed its versions, Vercel bills a list as an advanced operation, and the Hobby plan has a small monthly allowance. The store moved to one Postgres row per workspace (a free Supabase project in us-east-1, the same `Workspace` document, an optimistic version check in the upsert) behind one `DocStore` interface in `db.ts`. Consequence: one query per read, no listing, no read lag; the Blob backend stays behind `BLOB_READ_WRITE_TOKEN` with the caveat written beside it in the README. Workspaces created on Blob before the suspension could not be migrated because reads were blocked, so the public demo starts fresh.
