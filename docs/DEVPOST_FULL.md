# Shop Rules: Devpost submission, every field

> Every number below is copied from `docs/FACTS.md` (run of 2026-10-30T03:45:54Z) or listed with a reason in `docs/numbers_allowed.txt`. Before the final paste: run `scripts/facts.mts` once more if the code changed, refresh the numbers marked FACTS, and replace the video line with the YouTube link.

---

## 1. Project overview

**Project name (60 max):**
Shop Rules

**Elevator pitch (200 max):**
The compliance clerk that quotes its sources. Shop Rules watches tariffs, product safety rules, and state nexus thresholds for each listing you sell, drops any alert it cannot quote, and drafts the reprice.

**Thumbnail (3:2):**
The product page with the de minimis alert open: the accent card, the evidence counter, and the "Draft reprice" block. Fallback: the Watchlist feed with one grouped product card. Export at 1800 by 1200 from the screenshots under `docs/design` or a fresh capture of https://shop-rules.vercel.app.

---

## 2. About the project (Markdown, the public page)

### Shop Rules: the compliance clerk that quotes its sources

> **Tavily reads the official page. Nemotron 3 Ultra decides. A verifier outside the model drops what it cannot quote. You approve the step.**

| | |
|---|---|
| **Try it** | https://shop-rules.vercel.app (click "Load demo shop", open a product, run a check; about 40 seconds for the seed) |
| **Code** | https://github.com/anudeep-bonagiri/ShopRules |
| **Extension** | packaged build at `extension/shop-rules-extension.zip` in the repo, loads unpacked |

### Inspiration

A solo seller on Etsy, Shopify, or Amazon is also the import compliance officer, the product safety officer, and the sales-tax department. Tariff rates on the goods they import changed repeatedly this year, de minimis treatment for low-value imports from China was suspended, and every state has its own nexus threshold. The information is public, on government pages, and nobody has time to read it for every product. The seller we built this for would rather be told "this rule touches this listing, here is the sentence, here is the new price" than be sent a newsletter.

### What it does

Paste a listing URL (or press Alt+Shift+S on the listing with the Chrome extension). Tavily Extract reads the page and Nemotron 3 Nano turns it into a profile: origin, materials, whether it is for children, cosmetic, electronic, textile, and up to three HTS headings with a confidence. Shop Rules seeds watch rules on official domains (CBP, USTR, the Federal Register, CPSC, FDA, FTC, OEHHA, the revenue site of each state you ship to, and the marketplace's own policy pages). On every run, Tavily Search finds the pages, Tavily Extract pulls the chunks that matter, and Nemotron 3 Ultra decides whether the change touches this product, how severe, effective when, and what to do. A verifier outside the model checks every claim's quote against the extracted text and rejects what is not there. The alert shows what was proposed, backed, and rejected, with the quote and the source. The action is a reprice with the price that keeps your margin, a compliance step, or a tax registration. Dismiss an alert with a reason and it becomes a standing instruction the next check follows. A cost receipt shows which model did what and what sending everything to Ultra would have cost.

The moment, as a judge can replay it:

1. Open the demo, click "Load demo shop". A wooden stacking toy made in China, a USB desk lamp with a lithium battery, and an organic cotton tee are watched; the toy's rules run. The toy gets 12 rules (4 tariff, 3 safety, 4 tax, 1 policy) (FACTS).
2. Open the toy. The de minimis alert reads: "The de minimis duty-free exemption for low-value imports from China has been suspended since May 2025, so this $34 toy now owes duty and formal entry fees on every shipment." Its evidence counter reads 3 of 3 backed, effective 2025-05-02. Across the four tariff rules of the first check: 12 claims proposed, 10 backed, 2 rejected and shown as rejected; every source domain was a .gov site, 5 of 5 (FACTS).
3. Click a claim. The quote is the sentence from the official notice, and the source link opens it. A rejected claim stays on the card with its label, so you can see what the model proposed and the verifier refused.
4. Click "Forge a check". Nemotron 3 Ultra writes `check.py`, Nemotron 3 Nano writes the tests from the backed facts, a Token Factory sandbox runs them, and the forge page shows each step with its model and timing.
5. Dismiss the Prop 65 alert with "we already print the warning". The next check carries that instruction.

### How we built it

In the order a check flows, each with the file that holds it:

- **Ingest:** `ingestProduct` in `apps/web/src/lib/pipeline.ts`. Tavily Extract (`extract_depth` advanced) plus the page fields the extension scraped; a bot wall is detected and dropped, and Tavily Search by listing URL restricted to the store supplies the indexed listing when the fetch fails. Then Nemotron 3 Nano with JSON schema output into `ProductProfileSchema` in `apps/web/src/lib/schemas.ts`.
- **Rules:** `apps/web/src/lib/rules-catalog.ts`. Families: tariff, product safety, sales tax, marketplace policy. Each rule carries its official domains, a domain mode (restrict for tariff and safety), a cadence, and a seed note that is labelled as a seed in the UI.
- **Check:** `checkRule` in `apps/web/src/lib/pipeline.ts`. Tavily Search (`search_depth` advanced, `chunks_per_source` 3, `include_domains`, `time_range` year), Tavily Extract with the rule as the query, a content hash so unchanged sources are skipped, then Nemotron 3 Ultra with `RuleCheckSchema` and the seller's standing instructions in the prompt. Rules run three at a time; all bookkeeping lands in one write.
- **Verifier:** `apps/web/src/lib/verifier.ts`. Normalized substring match, then six-word shingles at 80 percent. Presence only; rejected claims stay visible.
- **Rule Forge:** `apps/web/src/lib/forge.ts` and `apps/web/src/lib/sandbox.ts`. Ultra writes a deterministic `check(sources)` extractor, Nano writes `test_check.py`, a disposable Token Factory sandbox (Contree REST, networking off) runs the harness, Ultra revises on failure, up to three iterations. The forge page shows the step log, the code, the tests, and the sandbox output.
- **Store:** `apps/web/src/lib/db.ts`. One JSON document per workspace in a Postgres row (Supabase), read in one query and written back with an optimistic version check; the Blob backend from the first day stays behind one interface for self-hosters.
- **UI:** Next.js 14 with Shopify Polaris 13 and a token sheet derived from Polaris (`docs/design/DESIGN.md`): a Watchlist feed with one card per product, a Product Inspector, alerts with the evidence check first, a cost receipt, settings.
- **Extension:** `extension/`, Manifest V3, vanilla TypeScript. Hover a listing, press Alt+Shift+S, get the inspector overlay: rules, open alerts, price history, competitor prices (Tavily Search plus Nano), and "Watch this product", which sends the page fields along so ingestion works where marketplaces block readers. Tested against production on a live Amazon listing, an Etsy category page, and a Shopify store on its own domain.
- **Delivery:** a daily Vercel cron, the extension badge every 15 minutes, Telegram when a bot token is set.

Also in the path: `docs/competitors.md`, a teardown of 6 competitor extensions with REA (Keepa, Camelizer, Honey, Helium 10, Jungle Scout, AMZScout); none of them handles tariffs, safety rules, or nexus, which is the gap.

Engineering: `scripts/facts.mts` runs one measured cycle and writes `docs/FACTS.md`; `docs/not-built.md`, `docs/CLAIMS_AUDIT.md`, `docs/JUDGE_QA.md`, `docs/DECISIONS.md`, and `docs/PROJECT_STATUS.md` say what is real, what is not, and why. CI typechecks both packages, builds both, runs gitleaks, and fails on an em dash in the outward prose.

### How we meet each track

| Track | What the judges ask | What Shop Rules does |
|---|---|---|
| Personal AI Track | An always-on, private assistant with persistent memory, reusable skills, the tools and information you choose, and action across daily workflows | A daily watch loop plus on-demand checks; a workspace that remembers products, rules, alerts, price history, learned instructions, and forged checks; skills written from your dismissals; official domains you can see per rule; reprice and compliance steps drafted for approval; data in your own Blob store or Postgres |
| Best Use of Tavily | A functional, runtime call to the Tavily API as part of the solution | Search and Extract on every check with domain filters and query-focused chunks, Extract on ingest, Search for competitor prices, and Search plus Extract to build the inputs the forged code runs on. The verifier works because the quotes come from text Tavily selected for the question |

Rule Forge is also why a judge from the Coding and Agentic Engineering track sees Token Factory used for execution, not only inference: Ultra writes the check, Nano writes the tests, a Token Factory sandbox runs them, Ultra revises; each forge keeps its code, tests, step log, and sandbox operation id.

### Challenges we ran into

**Nano returned nothing.** With thinking on, a long listing prompt spent the whole completion budget on reasoning and `content` came back empty. Fixed with `chat_template_kwargs` `enable_thinking` false on structured calls and the structure moved into the prompt (D-3 in `docs/DECISIONS.md`).

**Reads lagged writes.** One Blob file per workspace with ETag preconditions failed under read lag even with retries. Replaced by immutable versions resolved through the listing API, which was consistent in every probe (D-2), and that listing is what sank the store next.

**The store got suspended.** Hours before the deadline Vercel Blob answered every read with "Your store is blocked": the versioned design listed blobs on each read, Vercel bills a list as an advanced operation, and the Hobby allowance ran out. The workspace store moved to Postgres (one row per workspace, optimistic version check) behind the same interface in `db.ts`; Blob stays as an alternative backend (D-12).

**A blog in the evidence.** In prefer mode the origin-tariff rule surfaced a toy retailer's post next to the Federal Register. Tariff and safety rules now use the restrict mode on official domains (D-4).

**Tests that never ran.** Nano named its tests with an assert prefix; the harness only ran functions named with a test prefix. The harness now accepts both and the prompt insists on the test prefix.

**Buttons that clipped.** The first feed design clipped its action buttons at a wide MacBook window and printed each action twice. The final pass groups alerts under one card per product and prints each action once.

**Cron limits.** The Hobby plan refuses more than one scheduled run a day; the code is written for six hours. Judges run checks by hand from the product page, which is the demo path.

### What we got wrong

Rule Forge's sandbox step depends on the Token Factory project id being set on the deployment; where it is not, the forge card says "Not run" and shows the code and tests anyway (FACTS records that status for the measured run). The verifier checks that a quote exists, not that it supports the claim, so a confidently misread sentence can pass; that is why rejected claims stay visible and every source is one click away. The cost saving from routing is modest on a single cycle, 5 percent (FACTS), because the decision step on Ultra dominates; it grows with the Nano-heavy parts (classification, compare, skills) a seller uses day to day. Prices are list prices from third-party trackers until replaced with the invoice. Tax and marketplace-policy rules use prefer mode, so a non-official page can appear in their evidence; the domain is printed on every evidence line.

### Accomplishments that we're proud of

- 10 of 12 claims backed by the extracted source text on the first measured check, the other 2 rejected and shown, in 10.7 seconds for 4 rules, with 5 of 5 source domains on .gov (FACTS).
- One Nemotron Nano call classified a listing into origin, HTS candidate, and the rule set in 3.1 seconds (FACTS).
- A coding agent that produces a 49-line deterministic extractor and 4 tests for a tariff rule in 8.4 seconds (FACTS), with every step logged, and a store that survived its own outage (D-12).

### What we learned

The hard part is not finding the regulation; it is refusing to repeat it unless the sentence is on the page. Routing is a product feature when the receipt is on screen. A sponsor tool earns its place by filling one need: Tavily found and chunked the official page, Token Factory decided and then ran the code.

### What's next

Shopify and Etsy OAuth so prices and sales figures are real, forged checks re-running on the schedule instead of the model, Tavily Crawl over state revenue sites for the nexus rules, and a Postgres backend with accounts.

### Try it

```bash
git clone https://github.com/anudeep-bonagiri/ShopRules.git
cd ShopRules
npm install
cp apps/web/.env.example apps/web/.env.local   # add NEBIUS_API_KEY, DATABASE_URL (or BLOB_READ_WRITE_TOKEN), CRON_SECRET; TAVILY_API_KEY optional
npm run dev
```

---

## Built with (tags, up to 25)

nvidia-nemotron, nebius-token-factory, nebius-sandboxes, tavily, typescript, nextjs, react, shopify-polaris, vercel, postgres, supabase, chrome-extension, esbuild, zod, openai-sdk, python

## Try it out links

- https://shop-rules.vercel.app
- https://github.com/anudeep-bonagiri/ShopRules

## Image gallery (3:2, 1800x1200)

1. Watchlist feed: one product card with its alert rows and the metric strip.
2. Product Inspector with the de minimis alert open and the evidence counter.
3. Alert page: claims with Backed labels, quotes, and source links.
4. Forge page: the write, test, run, revise timeline with model badges.
5. Chrome extension overlay on an Amazon listing.
6. Cost receipt.

## Video demo link

Under three minutes, public on YouTube. Script and shot list: https://github.com/anudeep-bonagiri/ShopRules/blob/main/docs/VIDEO.md. Open on the extension overlay appearing over a listing, then the alert and its quote, then the forge timeline. Every spoken number is read off a screen element. No replayed footage. Paste the YouTube URL on this line at submit time.

---

## 3. Additional info (this hackathon's form)

**Track (pick one):** Personal AI Track

**Sponsor / Special Prizes (selected):** Personal AI Track; Best Use of Tavily
**Do not select:** Best Apps and Agents Track; Physical AI Track; Coding and Agentic Engineering Track

**Working demo URL:** https://shop-rules.vercel.app

**Public code repository:** https://github.com/anudeep-bonagiri/ShopRules (MIT, license visible in the About box)

**Did the project exist before the submission period?** No. Everything was built during the submission period; the first commit is dated October 29, 2026.

**IRL Builders & Brews city:** leave blank unless a team member attended one, then name that city.

**Feedback on Nebius Token Factory, AI Cloud, and the NVIDIA models (required field):**

Nebius Token Factory: the OpenAI-compatible endpoint and JSON schema output made Nemotron a drop-in behind the OpenAI SDK; zero to hello world took one curl. One gotcha: thinking is on by default and can consume the whole completion budget on a long structured prompt, so `enable_thinking` false belongs in every quickstart for structured output. We would build with it again for the price-to-latency ratio on Nano. The Sandboxes REST API is clean (spawn, poll, result) but the project id is a separate header that the key does not imply, and the error message should say where to find it.

NVIDIA Nemotron 3: Nano is fast and cheap enough to classify every listing and write tests; Ultra's rule decisions were specific and quoted correctly; both followed a JSON schema without retries once thinking was off. What needs work: a documented way to ask Nano for compact JSON when the output is long, because one competitor-price call came back truncated before we raised the budget.

Tavily: `include_domains` with restrict and prefer modes plus `chunks_per_source` on Extract are what make a verifier practical; keyless mode let the app run before the key arrived. One wish: a way to ask Search for the most recent version of a government page on the free tier (the `max_age_hours` flag exists but can be refused under load).

**AI tools used:** Nemotron 3 Nano and Ultra on Token Factory in the product; Claude Code during development.

**Did you implement a generative AI model or API, how and why:** Nemotron 3 Nano (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) and Nemotron 3 Ultra (`nvidia/Nemotron-3-Ultra-550b-a55b`) through Token Factory's chat completions with JSON schema output and thinking off. The box: Nano classifies and writes tests and instructions; Ultra decides and writes code; neither can create an alert without a quote the verifier finds in the extracted text; the generated code runs with networking off in a disposable sandbox; nothing changes a listing without the seller.

**Team emails, universities:** anudeep.bonagiri@gmail.com (Anudeep Bonagiri, University of Texas at San Antonio); Sudeep (GitHub RedWhite-cmd) and Sujeeth (GitHub Rebootroma) add their own email and university on the form the morning of.

---

## Paste-time checklist

- Every number on the page appears in `docs/FACTS.md` or `docs/numbers_allowed.txt`. None typed.
- Every sponsor line describes something that runs at submit time.
- No em dashes.
- The first sentence a judge reads names the mechanism.
- "Not built" is said plainly, once, in "What we got wrong" and in `docs/not-built.md`.
- Every link answers a GET; the repo is public; `.env` files are ignored.
- The selected tracks equal `docs/tracks_allowed.txt`; the track dropdown says Personal AI Track.
- The video line carries the YouTube URL; the demo URL and repo URL are filled.
- Team emails, universities, and the IRL city (if attended) filled on the form.
