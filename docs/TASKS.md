# One product, one need per sponsor

Written before the code and kept current. "What the judges ask" is copied from the Devpost prize page in
its words. Each sponsor fills exactly one need; a change that does not fit a row's "used for exactly"
column does not go in. A row whose "runs at submit time" column is empty is deleted from the Devpost page.

| Track | What the judges ask (their words) | The need | Used for exactly | Not used for | Runs at submit time |
| --- | --- | --- | --- | --- | --- |
| Personal AI Track (selected) | an always-on, private assistant with persistent memory, reusable skills, the tools and information you choose, and action across daily workflows | a seller's compliance clerk that remembers the products, the rules, and the seller's standing instructions | the daily watch loop and on-demand checks; the workspace (products, rules, alerts, prices, skills, forges); skills written from dismissals; reprice and compliance steps drafted for approval | writing to a store or a listing (not built) | https://shop-rules.vercel.app; `scripts/full_run.sh` |
| Best Use of Tavily (selected) | a functional, runtime call to the Tavily API as part of the solution | find the official page and the chunk of it that answers the rule, so a quote can be verified | Search plus Extract on every check (domain filters, query-focused chunks); Extract on ingest; Search by listing URL when a marketplace serves a bot wall; Search for competitor prices; Search plus Extract to build the inputs a forged check runs on | deciding (Nemotron does that); storage | every check on the public demo; `scripts/full_run.sh` |
| Nebius Token Factory and NVIDIA Nemotron 3 (platform requirement, every track) | build on Token Factory with the Nemotron models | decide whether a rule touches a product, classify a listing, write the check code and its tests | Nano: listing profile, competitor parsing, skills, tests. Ultra: rule decisions, check code, revisions. JSON schema output, thinking off | fetching the web (Tavily does that); verifying quotes (code does that) | every check and every forge on the public demo |
| Token Factory Sandboxes (part of the platform row) | agents that write, run, and test code in Token Factory | run the forged check and its tests with networking off | the harness run in a disposable container, one per iteration | anything the seller sees before the tests pass | only with `NEBIUS_PROJECT_ID` set; otherwise the forge card says "Not run" and FACTS records status unrun |
| Coding and Agentic Engineering Track (not selected) | coding agents and developer tools: agents that write, run, and test code in Token Factory | Rule Forge is the reason it could be selected | the row above | | not selected; the Devpost page lists it under "Do not select" |

The selected tracks are spelled in `docs/tracks_allowed.txt`. The track table on the Devpost page is a
copy of the selected rows of this file.
