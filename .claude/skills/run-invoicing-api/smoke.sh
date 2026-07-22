#!/usr/bin/env bash
# Driver for invoicing-api (NestJS). Boots the app against the local MySQL and
# smoke-tests the key surfaces: auth is enforced (401), login mints a JWT, and
# an authed read works. Exits 0 only if all checks pass.
#
# Usage:  bash .claude/skills/run-invoicing-api/smoke.sh
# Env overrides:
#   APP_PORT           (else read from .env, else 8080)
#   DB_COMPOSE_DIR     path to the invoicing-backend compose (default ../invoicing-backend)
#   SMOKE_EMAIL / SMOKE_PASSWORD  login creds (default the seeded super-admin)
set -uo pipefail

# Resolve the invoicing-api root (three levels up from this skill dir).
API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$API_DIR"

# nvm is not on PATH in non-interactive shells here.
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
# This host resolves the npm registry IPv6-only and IPv6 egress is slow.
export NODE_OPTIONS=--dns-result-order=ipv4first

# Isolated test port so the driver never clashes with a server already running
# on the .env APP_PORT. Overridable via APP_PORT.
PORT="${APP_PORT:-8199}"
export APP_PORT="$PORT"
DB_COMPOSE_DIR="${DB_COMPOSE_DIR:-$API_DIR/../invoicing-backend}"
DB_PORT="$(grep -oE '@[^:]+:[0-9]+/' .env 2>/dev/null | grep -oE '[0-9]+' | head -1)"; DB_PORT="${DB_PORT:-3307}"
SMOKE_EMAIL="${SMOKE_EMAIL:-discoverforoneself@gmail.com}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-password1234}"
BASE="http://localhost:${PORT}/api"

log(){ echo "[smoke] $*"; }
fail(){ echo "[smoke] FAIL: $*" >&2; exit 1; }

# 1) Ensure MySQL is reachable (it lives in the sibling invoicing-backend repo).
if ! (timeout 2 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/${DB_PORT}") 2>/dev/null; then
  log "MySQL not up on :${DB_PORT} — starting it via ${DB_COMPOSE_DIR}"
  (cd "$DB_COMPOSE_DIR" && docker compose up -d mysql) || fail "could not start MySQL"
  for i in $(seq 1 30); do
    (timeout 2 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/${DB_PORT}") 2>/dev/null && break
    sleep 2
  done
fi
log "MySQL reachable on :${DB_PORT}"

# 2) Build if needed.
if [ ! -f dist/main.js ]; then
  log "dist/main.js missing — building"
  npm run build >/tmp/invapi-build.log 2>&1 || { cat /tmp/invapi-build.log; fail "build failed"; }
fi

# 3) Boot the app.
log "booting on :${PORT}"
node dist/main >/tmp/invapi.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

up=""
for i in $(seq 1 40); do
  curl -s -o /dev/null "${BASE}/invoices/currency-codes" && { up=1; break; }
  sleep 1
done
[ -n "$up" ] || { tail -30 /tmp/invapi.log; fail "server did not come up (see /tmp/invapi.log)"; }
log "up after ${i}s"

# 4) Checks.
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/invoices/currency-codes")
[ "$CODE" = "401" ] || fail "expected 401 for unauthenticated read, got ${CODE}"
log "auth enforced (401 unauthenticated) OK"

LOGIN=$(curl -s -X POST "${BASE}/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"${SMOKE_EMAIL}\",\"password\":\"${SMOKE_PASSWORD}\"}")
TOKEN=$(printf '%s' "$LOGIN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.body&&j.body.data&&j.body.data.token)||"")}catch(e){}})')
[ -n "$TOKEN" ] || { echo "$LOGIN" | head -c 300; fail "login did not return a token (check creds / seed)"; }
log "login OK (JWT len ${#TOKEN})"

CC=$(curl -s "${BASE}/invoices/currency-codes" -H "Authorization: Bearer ${TOKEN}")
echo "$CC" | grep -q '"responseCode":"00"' || { echo "$CC" | head -c 300; fail "authed read did not return responseCode 00"; }
log "authed read OK: $(echo "$CC" | head -c 120)"

log "ALL CHECKS PASSED"
