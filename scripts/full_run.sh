#!/usr/bin/env bash
# The measured cycle, fresh workspace to facts, in one command, timed: the
# fixture check, one live cycle (ingest, first checks, one forge, the verifier
# self-check), then the honesty block and the "run of" timestamps. Every number
# on the Devpost page comes from the files this writes. Needs the network and
# the keys in apps/web/.env.local; never prints them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
mkdir -p logs
T0=$(date +%s); step() { printf '\n==> %s (%ss)\n' "$*" "$(( $(date +%s) - T0 ))"; }

step "dependencies"
[ -d node_modules ] || { echo "node_modules missing; installing (needs the network the first time)"; npm ci --silent || npm install --silent; }

step "environment"
set -a; . ./apps/web/.env.local; set +a
echo "NEBIUS_API_KEY set: $([ -n "${NEBIUS_API_KEY:-}" ] && echo yes || echo no); store: $([ -n "${DATABASE_URL:-}" ] && echo postgres || ([ -n "${BLOB_READ_WRITE_TOKEN:-}" ] && echo blob || echo none)); Tavily: $([ -n "${TAVILY_API_KEY:-}" ] && echo keyed || echo keyless); sandbox project: $([ -n "${NEBIUS_PROJECT_ID:-}" ] && echo set || echo unset)"

step "fixtures byte-identical to the committed ones"
npx -y tsx@4.19.4 seed/generate.mts --out logs/fixtures > /dev/null
diff -r logs/fixtures seed/fixtures && echo "seed/fixtures match"

step "one live cycle (logs/facts.log): ingest, 4 rule checks, one forge, the verifier self-check"
npx -y tsx@4.19.4 scripts/facts.mts > logs/facts.log 2>&1 || { echo "facts failed; the end of logs/facts.log:"; tail -20 logs/facts.log; exit 1; }
sed -n '1,12p' docs/FACTS.md

step "honesty block and run-of timestamps"
python3 scripts/honesty.py

step "facts header"
sed -n '3p' docs/FACTS.md
printf '\ntotal %ss\n' "$(( $(date +%s) - T0 ))"
