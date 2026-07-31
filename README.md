# Motor City Supply Game

A modern rebuild of the Motor City supply-chain simulation. The rules remain compatible with the original game while the interface, accessibility, reliability, security, and deployment model are being replaced.

This repository is private during development. The original `23rli/PullingSupplyGame` repository and its AWS deployment are intentionally untouched.

## Current milestone

The local overhaul now includes:

- all four original car recipes and economics
- Planning, Manufacturing, Assembly, Quality, Paint, and Done stages
- top-lane-first resource allocation
- one-stage movement and round wait requirements
- two-round paint processing with capacity three
- exact four-for-one resource conversion
- round reset checkpoints and local session recovery
- classic and random resource plans
- live revenue, WIP, projected penalty, and round history
- configurable models, end-run summary, and CSV export
- responsive mouse, touch, and keyboard controls
- independent player factories sharing one facilitator schedule
- create, join, secure rejoin, start, end, roster, and leaderboard flows
- facilitator-selected WIP and report cutoff rounds
- authoritative server commands with optimistic versions and idempotency
- HttpOnly 12-hour sessions, revocation, and rotating recovery codes
- embedded PostgreSQL locally and pooled TLS PostgreSQL in production
- a same-origin hardened container runtime with CSP and rate limiting

AWS account infrastructure, legacy credential containment, migration rehearsal, and production cutover remain intentionally unexecuted. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Run locally

Requires Node.js 22.12 or newer.

```powershell
npm ci
npm run dev:full
```

Open `http://localhost:5173`.

The API runs at `http://127.0.0.1:3001`; Vite proxies `/api` during development. Local team data persists under the ignored `data/` directory.

## Verify

```powershell
npm test
npm run lint
npm run build
npm audit
```

## Production runtime

Production requires managed PostgreSQL and never falls back to local disk. Inject `DATABASE_URL` and `DATABASE_SSL_CA` from the managed secret/configuration system, run `npm run db:migrate:built` once, then start the application with `npm run start:api`.

Build the single-origin web/API image with `docker build -t motor-city-supply-game .`. The container runs as the unprivileged Node user and exposes port `3001`.

## Structure

```text
src/
  assets/cars/       Optimized original car artwork
  components/        Accessible game and tool surfaces
  game/              Pure rules engine, reports, and tests
  team/              Team launcher, API client, and session consoles
  MotorCityApp.tsx   Shared solo/team factory shell
server/
  db/                PostgreSQL clients and schema
  app.ts             Validated Fastify HTTP contract
  *-store.ts         Authoritative snapshots and transactions
docs/
  API.md             HTTP and session contract
  ARCHITECTURE.md    Ownership and deployment boundaries
  PARITY.md          Preserved gameplay contract
  ROADMAP.md         Approved phased delivery plan
  SECURITY.md        Immediate and target security posture
```

## Design principles

- Rules live in the pure engine, not React components.
- Every rule change requires an executable test and an explicit parity decision.
- Touch and keyboard interactions are first-class, not fallbacks.
- Secrets, database addresses, and environment URLs never enter source control.
- The old deployment remains available until a tested parallel cutover.
