# Judge Q and A

Answers point at files that exist. "Not built" is a complete answer.

## Tavily judges

**Which endpoints do you call at runtime?** Search and Extract on every check (`apps/web/src/lib/pipeline.ts`, `checkRule`). Extract on ingest (`ingestProduct`). Search for competitor prices (`compareListings`). Search and Extract again inside Rule Forge to build the inputs the generated code runs on (`apps/web/src/lib/forge.ts`). Map and Crawl are implemented in `tavily.ts` and not in the default loop.

**Why Search then Extract instead of one call?** Search with `search_depth=advanced`, `chunks_per_source=3`, and domain filters finds the pages; Extract with the rule as `query` and `chunks_per_source=3` returns the chunks that matter. The verifier only accepts quotes found in that text, so the quality of the extracted chunks is what makes the verifier practical.

**How do you keep the model on official sources?** `include_domains` with `include_domains_mode: "strict"` for tariff, Section 301, and safety rules; `prefer` for rules where the official site may not answer the query (de minimis, HTS line, state nexus, marketplace policy). The domains per rule are visible on the Watch rules page. `docs/FACTS.md` lists the domains actually read in the measured run.

**What happens without a key?** `tavily.ts` sends `X-Tavily-Access-Mode: keyless` and Search and Extract keep working within Tavily's keyless limits. Map and Crawl need a key and say so.

**What did Tavily do that nothing else could?** Return LLM-sized chunks from government pages with a domain filter in one call, cheaply enough to run on every product on a schedule. The quotes the verifier checks come from text Tavily already selected for the question.

## NVIDIA and Nebius judges

**Which models and why?** Nemotron 3 Nano for listing classification, competitor parsing, standing instructions, and test writing. Nemotron 3 Ultra for the one hard decision per rule and for writing and revising check code. Nemotron 3 Super is configured and unused by default. Model ids in `apps/web/src/lib/nemotron.ts` and `docs/FACTS.md`.

**How do you use Token Factory beyond chat?** JSON schema output (`response_format: json_schema` through the OpenAI SDK's `zodResponseFormat`), `chat_template_kwargs.enable_thinking` to turn reasoning off for structured calls, and the Sandboxes API (Contree REST) to run the agent's Python in a disposable, network-off container (`apps/web/src/lib/sandbox.ts`).

**Why is thinking off?** With thinking on and a long prompt, Nano spent the completion budget on reasoning and returned empty content (logged in `docs/PROJECT_STATUS.md`). The prompts carry the structure instead. `NEMOTRON_ULTRA_THINKING=1` turns it back on for Ultra.

**How is cost controlled?** The receipt page computes what the same tokens would cost on Ultra alone and shows the saving. The figures are in `docs/FACTS.md`. Prices are list prices until replaced with the invoice.

**What does the coding agent produce?** A short Python module `check(sources) -> {found, value, quote, source_url, fact}` for one fact per rule, tests derived from facts the verifier already backed, a sandbox run, and up to three revisions. A passing check is stored with its code, tests, step log, and sandbox operation id. See `/forge/[id]` in the app.

## Personal AI track

**Always-on?** A Vercel cron runs the watch loop; the extension polls for new alerts every 15 minutes and shows a badge; Telegram delivery is available with a bot token.

**Persistent memory?** The workspace document: products, rules, alerts, price history, learned instructions, cost receipts, and forged checks. `apps/web/src/lib/db.ts`.

**Reusable skills?** Dismiss an alert with a reason and Nano writes a one-line standing instruction scoped to the product, the rule family, or the account. Future checks follow it.

**Data under the seller's control?** One Postgres row per workspace, read and written only by the app. Self-host with your own Postgres (`apps/web/supabase/store.sql`) or your own Blob store. No one else's data is in the document, and the schema is two tables.

**Takes action?** Drafts the reprice with the price that keeps your margin, the compliance step, or the tax registration; the seller approves. It does not change a listing by itself (`docs/not-built.md`).

## General judges

**What is real and what is simulated?** Everything on the public demo is a live call: Tavily, Nemotron, the sandbox when configured. The "Load demo shop" button adds three listings whose page fields are supplied the way the extension supplies them. Nothing is replayed.

**What is the worst failure mode?** A claim that is backed by a real quote but misread by the model. The verifier cannot catch that. That is why rejected claims stay visible, every source is one click away, and alerts say "might apply" when a detail is unconfirmed.

**What would you do with a week?** Shopify and Etsy OAuth so the price and the sales figures are real, a Postgres backend with accounts, and a forge that re-runs its checks on the schedule instead of the model.
