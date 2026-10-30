#!/usr/bin/env bash
# One command from a bare clone to the judging start state: dependencies, the
# environment check, the fixture check, a production build of the web app, and
# the health line. Shop Rules has no offline mode (docs/not-built.md): every
# check calls Tavily and Nemotron live, so this needs the network and the keys
# in apps/web/.env.local. Keys are never printed; only whether they are set.
#   scripts/demo_up.sh            build and serve on http://localhost:3000
#   scripts/demo_up.sh --no-web   dependencies, environment and fixtures only
#   PORT=3111 scripts/demo_up.sh  another port
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
mkdir -p logs
PORT="${PORT:-3000}"
WEB=1
for a in "$@"; do case "$a" in --no-web) WEB=0 ;; *) echo "unknown option $a"; exit 2 ;; esac; done
step() { printf '\n==> %s\n' "$*"; }

step "1/4 dependencies"
if [ ! -d node_modules ]; then echo "node_modules missing; installing (needs the network the first time)"; npm ci --silent || npm install --silent; fi
echo "node $(node --version), npm $(npm --version)"

step "2/4 environment (apps/web/.env.local; values are never printed)"
ENV=apps/web/.env.local
[ -f "$ENV" ] || { echo "missing $ENV; copy apps/web/.env.example and fill it"; exit 1; }
for k in NEBIUS_API_KEY DATABASE_URL BLOB_READ_WRITE_TOKEN TAVILY_API_KEY CRON_SECRET NEBIUS_PROJECT_ID TELEGRAM_BOT_TOKEN; do
  if grep -q "^$k=." "$ENV"; then echo "  $k: set"; else echo "  $k: not set"; fi
done
grep -q "^NEBIUS_API_KEY=." "$ENV" || { echo "NEBIUS_API_KEY is required"; exit 1; }
grep -qE "^(DATABASE_URL|BLOB_READ_WRITE_TOKEN)=." "$ENV" || { echo "a store is required: DATABASE_URL (Postgres) or BLOB_READ_WRITE_TOKEN"; exit 1; }
grep -q "^TAVILY_API_KEY=." "$ENV" || echo "  (Tavily runs keyless; add a key for anything beyond a demo)"
grep -q "^NEBIUS_PROJECT_ID=." "$ENV" || echo "  (no sandbox: Rule Forge will label its run \"Not run\")"

step "3/4 fixtures are byte-identical to the committed ones"
npx -y tsx@4.19.4 seed/generate.mts --out logs/fixtures > /dev/null
diff -r logs/fixtures seed/fixtures && echo "seed/fixtures match"

if [ "$WEB" = 1 ]; then
  step "4/4 web, production build on port $PORT (logs/web-build.log, logs/web.log)"
  if lsof -ti ":$PORT" > /dev/null 2>&1; then echo "stopping the process on port $PORT"; lsof -ti ":$PORT" | xargs kill || true; sleep 1; fi
  npm run build:web > logs/web-build.log 2>&1 || { echo "build failed; see logs/web-build.log"; exit 1; }
  (cd apps/web && nohup npx next start -p "$PORT" > "$ROOT/logs/web.log" 2>&1 &)
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:$PORT/api/health" > logs/health.json 2>/dev/null; then break; fi
    sleep 1
  done
  [ -s logs/health.json ] || { echo "the web app did not answer on port $PORT in 60 s; see logs/web.log"; exit 1; }
  echo "health: $(cat logs/health.json)"
fi

cat <<READY

Ready. A fresh browser profile at http://localhost:$PORT is the judging start state (an empty workspace).
  Load demo shop:   the button on the home page (about 40 s: three listings, the toy's first checks)
  Terminal B:       scripts/rehearse.sh            walks the runbook with curl and prints every beat's time
  The numbers:      docs/FACTS.md                  regenerate with scripts/full_run.sh (one live cycle)
  Stop the server:  lsof -ti :$PORT | xargs kill
READY
