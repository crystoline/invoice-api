---
name: run-invoicing-api
description: Build, run, and smoke-test the invoicing-api NestJS backend. Use when asked to run, start, boot, build, test, or verify the invoicing API / NestJS backend, or reproduce an endpoint locally.
---

# Run invoicing-api (NestJS backend)

NestJS + Prisma (MySQL) REST API — the port of the Spring `invoicing-backend`.
It has no GUI; you drive it with **`.claude/skills/run-invoicing-api/smoke.sh`**,
a curl-based driver that boots the app against the local MySQL and verifies auth
+ an authed read. Paths below are relative to `invoicing-api/`.

This runs in WSL Ubuntu. **Node is via nvm** (not on the default PATH) and **the
npm registry resolves IPv6-only here** — every command sources nvm and sets
`--dns-result-order=ipv4first`. The driver does this for you.

## Prerequisites

- Node (nvm): `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` (default v24).
- Docker (for MySQL) — the DB lives in the sibling `../invoicing-backend` repo.
- MySQL up on host port **3307** with the `neutroninvdb` schema. The driver
  auto-starts it; to do it by hand:
  `cd ../invoicing-backend && docker compose up -d mysql`

## Build

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
export NODE_OPTIONS=--dns-result-order=ipv4first
cd invoicing-api
npm install                 # if node_modules is missing
npx prisma generate         # generates the Prisma client from prisma/schema.prisma
npm run build               # → dist/main.js
```

`.env` already has `DATABASE_URL` (mysql://invouser:...@localhost:3307/neutroninvdb),
`JWT_SECRET`, and `APP_PORT`. First-time DB setup (introspect the live schema +
seed roles/admin) is documented in `../invoicing-docs/migration-spring-to-nestjs.md`.

## Run (agent path — the driver)

```bash
bash .claude/skills/run-invoicing-api/smoke.sh
```

It: ensures MySQL is up (starts the sibling compose if not) → builds if `dist/main.js`
is missing → boots the app on an **isolated port 8199** (so it never clashes with a
server you're running on the `.env` port) → checks:

1. unauthenticated `GET /api/invoices/currency-codes` → **401** (auth enforced),
2. `POST /api/auth/login` (seeded super-admin) → mints a **JWT**,
3. authed `GET /api/invoices/currency-codes` → `responseCode "00"`.

Prints `ALL CHECKS PASSED` and exits 0, then stops the server. Server log → `/tmp/invapi.log`.
Overrides: `APP_PORT=… SMOKE_EMAIL=… SMOKE_PASSWORD=… DB_COMPOSE_DIR=… bash …/smoke.sh`.

Verified this session:
```
[smoke] MySQL reachable on :3307
[smoke] up after 3s
[smoke] auth enforced (401 unauthenticated) OK
[smoke] login OK (JWT len 316)
[smoke] authed read OK: {"responseCode":"00", ... "data":["NGN","USD",...]}
[smoke] ALL CHECKS PASSED
```

## Run (human path)

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; export NODE_OPTIONS=--dns-result-order=ipv4first
cd invoicing-api
node dist/main            # runs on .env APP_PORT (e.g. 8181); Ctrl-C to stop
# or: npm run start:dev   # watch mode
```
Swagger UI at `http://localhost:<APP_PORT>/swagger-ui`. Seed the DB with `npx prisma db seed`.

## Test

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; cd invoicing-api && npm test
```
Passes 1 spec (the scaffold's `app.controller.spec.ts`). No domain unit tests exist yet —
the real coverage is the `smoke.sh` driver above.

## Gotchas

- **Node/npm quirks (this host):** nvm must be sourced; the registry is IPv6-only and
  slow, so `npm install` fails with `npm error network` unless you set
  `NODE_OPTIONS=--dns-result-order=ipv4first` (and it helps to raise npm timeouts:
  `npm config set fetch-retries 5 fetch-timeout 600000`, already persisted in `~/.npmrc`).
- **`dist/main` path:** `tsconfig.build.json` excludes `prisma/` on purpose. Without that,
  `prisma/seed.ts` shifts the compiler rootDir and output lands at `dist/src/main.js`,
  and `node dist/main` fails with `MODULE_NOT_FOUND`.
- **DB credentials:** the MySQL volume was initialized with `invouser` /
  `your_secure_db_password` (from `invoicing-backend/.env`), **not** the compose fallback
  `7eventhChux`. Using the fallback → Prisma `P1000 Authentication failed`.
- **Prisma is pinned to v6** (not v7 — v7 changed its default generator/ESM and broke the
  `prisma-client-js` + CommonJS setup).
- **JWT:** HS256 with the secret **Base64-decoded** from `JWT_SECRET`; 2h exp **plus** a
  30-min `last_activity` inactivity window (Africa/Lagos, non-padded hour). For tokens to
  interoperate with the legacy Spring app at cutover, set `JWT_SECRET` to the legacy
  `JwtUtils` Base64 secret.
- **Response shapes:** most endpoints return `{responseCode,message,data}` at HTTP 200 even
  on logical failure (`"01"`); **login** returns a nested `{headers, body:{...token...},
  statusCode}` — the JWT is at `body.data.token`. Ids serialize as JSON numbers (BigInt→number).
- **Roles:** `ROLE_SUPER_ADMIN` is deliberately **not** treated as `ROLE_ADMIN` (matches
  legacy), so the super-admin gets `"01"` on admin-only endpoints like `GET /api/businesses`.
- **PDF endpoints** (`/api/invoices/:id/raw-download`, `/default-template-download`) need
  Chrome system libs (`libgbm1`, etc.) that are **not** installed in this WSL and require
  sudo — see `run-invoicing-frontend`'s prereqs for the exact `apt-get` line.

## Troubleshooting

- `EROFS: read-only file system` on any write → the WSL distro's root remounted read-only
  after a disk I/O error. Fix from Windows: `wsl --terminate Ubuntu` (remounts rw on next launch).
- `npm error network` → IPv6-only registry; prepend `NODE_OPTIONS=--dns-result-order=ipv4first`.
- Prisma `P1001 Can't reach database server` → MySQL is down; `cd ../invoicing-backend &&
  docker compose up -d mysql` (host port 3307).
- Prisma `P1000 Authentication failed` → wrong DB creds; use `invouser` (see Gotchas).
- `node dist/main` → `Cannot find module .../dist/main` → rebuild after confirming
  `tsconfig.build.json` excludes `prisma` (see Gotchas), which puts output at `dist/main.js`.
