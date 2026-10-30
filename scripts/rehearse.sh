#!/usr/bin/env bash
# Walk the judging runbook against a running Shop Rules (local or the public
# demo) with curl, and print the wall time of every beat. The workspace it
# creates is deleted at the end. Never pipes into head: outputs are captured
# and the first lines printed with sed, so a producer never gets SIGPIPE.
#   scripts/rehearse.sh                        against http://localhost:3000 (start it with scripts/demo_up.sh)
#   BASE=https://shop-rules.vercel.app scripts/rehearse.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"; mkdir -p logs
BASE="${BASE:-http://localhost:3000}"
JAR="logs/rehearse-cookies.txt"; rm -f "$JAR"
T0=$(date +%s); beat() { printf '[%3ss] %s\n' "$(( $(date +%s) - T0 ))" "$*"; }
first() { local n="$1"; shift; printf '%s\n' "$*" | sed -n "1,${n}p"; }
pyget() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

beat "health"; out=$(curl -sf "$BASE/api/health"); first 1 "$out"
beat "fresh workspace (the start state)"; curl -sf -c "$JAR" -b "$JAR" -o /dev/null "$BASE/"; out=$(curl -sf -b "$JAR" "$BASE/api/account" | pyget "'workspace ' + d['account']['id']"); first 1 "$out"
beat "Load demo shop (three listings, the toy's first checks)"; out=$(curl -sf -m 170 -b "$JAR" -X POST "$BASE/api/demo/seed" -H 'content-type: application/json' -d '{}' | pyget "str(len(d.get('products', []))) + ' products'"); first 1 "$out"
beat "the Watchlist: open alerts per product"; out=$(curl -sf -b "$JAR" "$BASE/api/products" | pyget "'; '.join(p['title'][:32] + ': ' + str(p.get('open_alerts', 0)) + ' open' for p in d['products'])"); first 1 "$out"
TOY=$(curl -sf -b "$JAR" "$BASE/api/products" | pyget "next(p['id'] for p in d['products'] if 'Stacker' in p['title'])")
beat "the toy's alerts and their evidence counters"; out=$(curl -sf -b "$JAR" "$BASE/api/alerts" | pyget "'\n'.join(a['headline'][:70] + ' | ' + str(a['backed']) + '/' + str(a['proposed']) + ' backed' for a in d['alerts'])"); first 4 "$out"
beat "Run check now on the toy (the checks route)"; out=$(curl -sf -m 170 -b "$JAR" -X POST "$BASE/api/products/$TOY/check" -H 'content-type: application/json' -d '{}' | pyget "str(d.get('checked')) + ' rules, ' + str(len(d.get('alerts', []))) + ' new alerts, ' + str(d.get('skipped_unchanged')) + ' unchanged'"); first 1 "$out"
beat "Forge a check (write, tests, run, revise)"; out=$(curl -sf -m 170 -b "$JAR" -X POST "$BASE/api/products/$TOY/forge" -H 'content-type: application/json' -d '{}' | pyget "'forge ' + str(d.get('forge', d).get('status')) + ', ' + str(len(d.get('forge', d).get('steps', []))) + ' steps'"); first 1 "$out"
beat "the cost receipt"; out=$(curl -sf -b "$JAR" "$BASE/api/receipt" | pyget "'runs: ' + str(len(d.get('runs', [])))"); first 1 "$out"
beat "delete the rehearsal workspace"; out=$(curl -sf -b "$JAR" -X DELETE "$BASE/api/account" | pyget "'deleted ' + d['deleted']"); first 1 "$out"
beat "done"
