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
