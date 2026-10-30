# RESULTS

Run of 2026-10-30T04:42:00Z. Rerun: `scripts/full_run.sh` (one measured cycle against the live APIs: `scripts/facts.mts`, then `scripts/honesty.py`).

## Metrics

| Metric | Result | Target |
| --- | --- | --- |
| Planted misquotes rejected by the verifier (fixture) | 8 of 10 | 10 of 10 |
| Decoy quotes accepted by the verifier (fixture) | 6 of 6 | 6 of 6 |
| Claims backed on the live check | 10 of 11 (1 rejected and shown) | every alert carries at least one backed quote |
| Official (.gov) source domains on the tariff rules | 5 of 5 | 5 of 5 |
| First check wall time, 4 rules | 13.4 s | under 20 s |
| Ingest wall time | 23.6 s | under 30 s |
| Nemotron spend, ingest plus check | $0.0239 | under $0.05 |
| Rule Forge | unrun, 56 lines, 3 tests, 11.7 s | tests pass in the sandbox |

## Hard negatives (decoys that look wrong and are legitimate)

| Id | Class | What it looks like | Verifier |
| --- | --- | --- | --- |
| c01 | two_sentences | two consecutive sentences quoted together | backed |
| c06 | case_and_whitespace | capitals, a line break and double spaces inside the quote | backed |
| c09 | mid_sentence_fragment | starts and ends mid-sentence, no capital, no period | backed |
| c10 | curly_apostrophe | typographic apostrophe where the page has a straight one | backed |
| c12 | elided_middle | an ellipsis drops the middle clause; both halves are on the page | backed |
| c14 | dash_variant | a hyphen where the page has an en dash | backed |

## Planted misquotes

| Id | Class | What was planted | Verifier |
| --- | --- | --- | --- |
| c02 | negated_long | one word inserted into a 42-word quote | backed (let through) |
| c03 | wrong_source | a real-looking sentence from a page that was never fetched, attributed to a fetched one | rejected |
| c04 | paraphrase | same meaning, different words; the model wrote it, the page did not | rejected |
| c05 | negated_short | a negation removed from an eight-word sentence | rejected |
| c07 | fabricated | a sentence that appears on no fetched page | rejected |
| c08 | threshold_changed | the dollar threshold changed | rejected |
| c11 | number_changed | one figure changed inside an otherwise exact sentence | rejected |
| c13 | stitched_same_source | two non-adjacent sentences of one page joined as if contiguous | backed (let through) |
| c15 | number_changed_long | one figure changed inside a 45-word quote, where most six-word shingles still match | rejected |
| c16 | stitched_two_sources | the first half of one page's sentence joined to the second half of another page's | rejected |

## Provenance

| Integration | This run |
| --- | --- |
| Tavily Search and Extract | live, keyed mode, 12 calls |
| Nemotron 3 Nano and Ultra on Token Factory | live, 7 calls |
| Token Factory Sandbox | did not run (Sandboxes are not configured: set NEBIUS_PROJECT_ID (Token Factory project settings) next to NEBIUS_API_KEY.) |
| Workspace store | postgres |

Nothing in this run was replayed, recorded, or stubbed.

## Cost

Nemotron: $0.0239 for ingest plus check, $0.0074 for the forge; the same tokens on Ultra only: $0.0255; saved by routing 6%.

## What is real

<!-- honesty:start -->
In the measured run of 2026-10-30T04:42:00Z, every Tavily call (12 in all, keyed mode) and every Nemotron call (7 in all) was live against the APIs; nothing was replayed, recorded, or stubbed.
The sandbox step did not run (Sandboxes are not configured: set NEBIUS_PROJECT_ID (Token Factory project settings) next to NEBIUS_API_KEY.); the forge card says the same.
The verifier backed 10 of 11 claims on the live check and rejected 1. On the planted fixture it rejected 8 of 10 misquotes and accepted 6 of 6 decoys; the misquotes it let through are named in docs/RESULTS.md.
<!-- honesty:end -->

## History

- 2026-10-30T03:04Z: first committed facts (Blob store). 12 claims proposed, 11 backed.
- 2026-10-30T03:22Z: facts after the ingest hardening; the forge wrote 0 test functions (assertions under comment headers), fixed by a retry-then-wrap guard.
- 2026-10-30T03:45Z: facts on the Postgres store after the Blob suspension; de minimis rule on official domains only; 4 test functions.
- 2026-10-30 later: verifier self-check added (seed/fixtures); fuzzy matches must carry every number; elided quotes checked part by part.

## Caveat

The listing is a stand-in Etsy URL with page fields supplied the way the extension sends them. The fixture pages under seed/ are synthetic and live on the reserved .invalid domain; they score the verifier and nothing else. The verifier checks that a quote is on the page, not that it means what the model says.
