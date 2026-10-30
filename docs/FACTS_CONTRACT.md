# The facts contract

The one generated file every number traces to. `scripts/facts.mts` is the only program in the repo that
reads `seed/fixtures/answer_key.json`; app code never imports or opens it. The script runs one live
cycle (ingest, the first rule checks, one forge), scores the verifier on the planted fixture, and writes
three files. Nothing in them is typed by hand. `scripts/full_run.sh` runs it and then `scripts/honesty.py`.

## docs/FACTS.json, keys

| Key | What |
| --- | --- |
| `asOf` | ISO timestamp of the run, without milliseconds; the only key a rerun comparison ignores |
| `models`, `prices_per_million` | the Nemotron model ids and the list prices the cost lines use |
| `tavily_mode` | `keyed` or `keyless` |
| `sandbox` {configured, image} | whether `NEBIUS_PROJECT_ID` was set and the image the forge would run on |
| `listing` {marketplace, title, price} | the stand-in listing the cycle watched |
| `ingest` {ms, origin_country, hts_top, intended_for_children, rules_seeded, rules_by_family, tavily_calls, llm[]} | the classification step |
| `check` {ms, rules_checked, unchanged, alerts, errors[], claims_proposed, claims_backed, claims_rejected, source_domains[], official_domains[], tavily_calls, llm[], alerts_summary[]} | the first rule checks and what the verifier did with the claims |
| `forge` {ms, status, iterations, fact_name, steps[], code_lines, test_functions, sandbox_note, last_output, llm_cost_usd, tavily_calls} | Rule Forge; `status` is `unrun` when the sandbox is not configured |
| `cost` {llm_usd, all_ultra_usd, saved_pct, by_tier, forge_llm_usd} | spend, the same tokens on Ultra only, the saving from routing |
| `verifier` {fixture_pages, fixture_claims, planted, planted_rejected, planted_backed[], decoys, decoys_backed, decoys_rejected[], by_class[]} | the self-check: planted misquotes that must be rejected, decoys that must be backed, and the ones that went the wrong way, each with its class and note |
| `account_id` | the throwaway workspace, deleted at the end of the run unless `KEEP_WORKSPACE=1` |

Keys this product does not have (investigations by source, refusals, settlement, a model-only baseline)
are absent rather than faked; nothing is replayed, so there is no replay count to report.

## docs/FACTS.md

The human page: the setup, the ingest numbers, the first check with every alert and its backed count,
the forge, the cost lines, the verifier self-check by class, and the caveats. The first lines say when it
was written. The README and the Devpost page copy from this file and say when.

## docs/RESULTS.md

Run date and the rerun command; a metric, result, target table; "Hard negatives" (the decoys and what
the verifier did); "Planted misquotes" (and which were let through); "Provenance" (Tavily, Nemotron,
the sandbox, the store); "Cost"; "What is real" (the honesty block); "History" (hand-written in
`docs/RESULTS_HISTORY.md`, copied in so a rerun never erases it); "Caveat".

## scripts/honesty.py

Owns exactly one block, between `<!-- honesty:start -->` and `<!-- honesty:end -->`, in the README
("What is real and what is simulated") and in RESULTS ("What is real"): the live-call counts, the sandbox
line, the verifier counts. It also rewrites every "run of <timestamp>" phrase in the README, the Devpost
source and the video script to the facts `asOf`, so the three cannot drift. It refuses the word
"autonomous" inside its block and prints "no change" when nothing moved. CI runs it and fails on a diff.

## seed/generate.mts

Deterministic (seed 42, no wall clock, sorted output): six synthetic pages on the reserved `.invalid`
domain, 16 claims, a hidden answer key with 10 planted misquotes by class (paraphrase, a changed number,
a changed number inside a long quote, a fabricated sentence, a sentence from an unfetched page, two kinds
of stitching, two negations, a changed threshold) and 6 decoys that look wrong but are legitimate (a
typographic apostrophe, capitals and whitespace, an en dash, an ellipsis, two sentences, a mid-sentence
fragment). Run it twice and diff: byte-identical. CI checks that.
