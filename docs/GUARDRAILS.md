# Model guardrails

Shop Rules uses NVIDIA Nemotron 3 (Nano and Ultra on Nebius Token Factory) to read official pages and decide whether a change touches a seller's product. The models are good at reading; they are not trusted with arithmetic, with staying on topic, or with remembering what the seller was already told. Three deterministic layers sit around every call. None of them call a model.

## 1. Facts in, numbers out of the prompt

- The classifier (Nano) can only pick a tariff heading from the curated catalog in `apps/web/src/lib/hts-catalog.ts`; the heading is an enum in the JSON schema. A keyword matcher over the listing text acts as the fallback and the cross-check (`finalizeHts`). A 6 or 8 digit refinement is a free-text suggestion the seller verifies with a broker.
- The rule checker (Ultra) never computes a price. It reports `tariff_rate_change_pct`, `estimated_cost_change_pct`, `effective_date`, relevance, severity, and steps. `apps/web/src/lib/pricing.ts` computes the reprice and stores the result on the alert; the web app and the extension render that stored result.
- The prompt carries the rule's alert history and the product's price trend (`historyContext` in `sanity.ts`) so the model reports only what is new, and it is told to ignore passages about other products, headings, countries, or states even on the same page.

## 2. The verifier

A claim is backed only when its quote appears in the text Tavily extracted from an official domain (`verifier.ts`: normalized substring, then 6-word shingles at 80%). Rejected claims stay visible on the alert page.

## 3. The audit (`apps/web/src/lib/sanity.ts`)

Runs after the verifier on every verdict, before an alert is created. Each adjustment is stored on the alert as a guardrail note and shown under "Evidence check".

| Check | What happens |
| --- | --- |
| Off-domain quote on a strict rule | Claim marked unbacked |
| No backed claims | Verdict dropped |
| Duty change outside -100..200 points, cost change outside -90..300% | Number dropped |
| Duty change on a safety, tax, or policy rule | Number dropped; a reprice becomes review |
| Quote states old and new levels, model reported a level | Change corrected to the difference (7.5 to 25 percent is 17.5 points) |
| Duty change not stated by any backed quote | Number dropped, relevance lowered to might affect |
| Effective date before 2018, more than 18 months out, or today's date | Date dropped |
| Action type that does not fit the rule family | Changed to review |
| Quotes, read with their surrounding source passage, name other headings or other origin countries only | Verdict dropped |
| Quotes name neither the product (type, materials, heading, origin) nor the rule's subject | Verdict dropped, except a universal tariff with a number or date, kept as might affect |
| Exclusion sentences ("does not change requirements for toys") | Ignored when matching the subject |
| Same finding already raised for this rule in the last 45 days | Verdict dropped |
| High severity under 5 duty points, or on an unconfirmed match | Lowered to medium |

## Tests

- `npm test` runs the unit tests for pricing, the HTS catalog, the guardrails, and the product overrides (`node --test`, no model, no network).
- `npm run eval:offline` replays the golden cases in `apps/web/src/lib/fixtures/eval-cases.json` (including traps: another heading on the right site, a crib rule shown to a toy, a 2019 action, a two-rate quote) through the verifier and the guardrails and writes `docs/EVAL.offline.md`.
- `npm run eval` runs the same cases against the live model with the production prompt and writes `docs/EVAL.md` with per-field accuracy and cost. It costs money and is run once before submission.
