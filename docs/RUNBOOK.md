# Judging runbook

The judge sees the public demo at https://shop-rules.vercel.app in a fresh browser profile (an empty
workspace). Shop Rules has no offline mode: every beat makes live calls to Tavily and Nemotron, so the
table needs the network. If the live site stalls for five seconds, switch to Terminal B (the same app on
localhost) and keep talking. Never debug live. Every number spoken is read off the screen element named
in the "See" column or off `docs/FACTS.md`; nothing from memory.

## 1. The beats

| Time | Say | Do | See (the element every number is read from) | Fallback (Terminal B) |
| --- | --- | --- | --- | --- |
| 00:00 | "Shop Rules is the compliance clerk that quotes its sources. Tavily reads the official page, Nemotron decides, a verifier outside the model drops what it cannot quote." | open the home page | the empty Watchlist with the "Load demo shop" button | `scripts/rehearse.sh` beat "health" |
| 00:15 | "Three listings a seller might have, and the first checks on the toy." | click "Load demo shop" | the three product cards appear; the toy's card shows its open-alert count (measured 2026-10-30 on the public demo: 43 s) | rehearse beat "Load demo shop" |
| 01:00 | "The de minimis alert. The counter says how many claims the model proposed and how many the verifier backed." | open the toy, open the de minimis alert | the evidence counter on the alert card ("n of m backed"); the effective date | rehearse beat "the toy's alerts" |
| 01:20 | "Click a claim: the quote is the sentence on the page, and the source opens." | click a claim, click its source link | the quote text and the domain on the evidence line; the official page in a new tab | the `sources` array in the alert JSON |
| 01:40 | "A rejected claim stays on the card with its label." | point at a rejected claim if the run produced one | the "Rejected" label | the `backed: false` claim in the alert JSON |
| 02:00 | "Forge a check: Ultra writes the extractor, Nano writes the tests, a Token Factory sandbox runs them." | click "Forge a check" | the forge timeline: write, tests, run; model badges and timings; the "Not run" label if the sandbox is not configured | rehearse beat "Forge a check" |
| 02:30 | "Dismiss with a reason and the reason becomes a standing instruction." | dismiss the Prop 65 alert with "we already print the warning" | the new skill on the rules page | `PATCH /api/alerts/:id` |
| 02:45 | "The receipt: which model did what, and what sending everything to Ultra would have cost." | open Receipt | the receipt table and the saved percentage | `GET /api/receipt` |

Measured times to say (from `docs/FACTS.md`, the facts header is the date): first check wall time for
4 rules, ingest wall time, claims backed of proposed, planted misquotes rejected of planted, decoys
accepted of decoys. Read them off the page, not from memory.

## 2. Two terminals

| Terminal | First line | Then |
| --- | --- | --- |
| A | the browser on https://shop-rules.vercel.app, fresh profile | the beats |
| B | `scripts/demo_up.sh` (builds and serves on port 3000), then `scripts/rehearse.sh` | the fallback column, in order; `BASE=https://shop-rules.vercel.app scripts/rehearse.sh` runs the same beats against the public demo |

## 3. Night before

- [ ] `scripts/demo_up.sh` once with the network on (it installs when missing), then once more; it must end at the health line with no install step.
- [ ] `scripts/full_run.sh` once, then read `docs/FACTS.md` and `docs/RESULTS.md`. Those are the only numbers to say.
- [ ] `scripts/rehearse.sh` against localhost and against the public demo; write the measured times here: demo_up ____ s, Load demo shop ____ s, check ____ s, forge ____ s.
- [ ] Laptop and charger; hotspot tested; the extension loaded unpacked from `extension/dist` with the token from Settings.
- [ ] Rehearse the opening twice.

## 3b. Deadline morning

1. `scripts/full_run.sh` and read the facts. 2. `python3 ~/.claude/skills/devpost/scripts/check_submission.py` with `--final`. 3. `scripts/demo_up.sh` to the start state. 4. Paste the Devpost fields; "submitted" on the page.

## 4. Reset between judges

A fresh browser profile (or Settings, delete workspace: `DELETE /api/account`) is the reset; it clears the
workspace and the cookie. The public deployment keeps running; nothing else to restart.

## 5. Failure modes

| Symptom | Do | Say |
| --- | --- | --- |
| "Load demo shop" takes more than a minute | wait once; then Terminal B, `scripts/rehearse.sh` | "Same pipeline on localhost; the public site is doing the same Tavily and Nemotron calls." |
| an alert shows 0 backed | leave it; it is the verifier working | "The model proposed, the verifier found no quote, the alert says so." |
| the forge card says "Not run" | read the label | "The sandbox needs the Token Factory project id; the code and tests are real, the run is not." |
| `/api/health` says `store: none` or a Blob error | check `DATABASE_URL` on the deployment (D-17) | "The store moved to Postgres the night before the deadline; this is the fallback path." |
| Tavily 429 in keyless mode | add `TAVILY_API_KEY` | "Keyless Tavily is rate limited; the key is the fix." |

## 6. Sponsor paragraphs

**Tavily.** The need: find the official page and the chunk that answers the rule. The file:
`apps/web/src/lib/pipeline.ts` (`checkRule`, `indexedListing`), `apps/web/src/lib/tavily.ts`. The number
to say: Tavily calls in the measured cycle, from `docs/FACTS.md`. The question they will ask: why
Extract with a query after Search? Because the chunk the verifier reads must be the chunk about the rule.

**Nebius Token Factory and Nemotron.** The need: decide, classify, write code. The file:
`apps/web/src/lib/nemotron.ts`, `apps/web/src/lib/forge.ts`. The number to say: Nemotron spend and the
saved percentage on the receipt. The question: why thinking off? Because structured output with the
budget spent on reasoning came back empty (D-3).

**Personal AI.** The need: a clerk that remembers. The file: `apps/web/src/lib/db.ts` (the workspace),
`skillFromDismissal` in `pipeline.ts`. The number: products, rules, alerts and skills in the workspace,
read off the Watchlist and the rules page.

## 7. Never say

- Never say "live" about the sandbox when the card says "Not run". The label on the card is the word to use.
- No number from memory. Read it off the screen or `docs/FACTS.md`.
- Never say the HTS heading is a classification; it is a candidate with a confidence.
