# Motor City Supply Game

A modern rebuild of the Motor City supply-chain simulation. The rules remain compatible with the original game while the interface, accessibility, reliability, security, and deployment model are being replaced.

This repository is private. The original `23rli/PullingSupplyGame` repository is untouched, and its
deployment still serves the old game on the same hostname over HTTP.

| | Address |
| --- | --- |
| New game | https://motorcity.boeingcenter.com |
| Old game | http://motorcity.boeingcenter.com |

Documentation: [docs/README.md](docs/README.md).
Training a professor, TA, or backup facilitator: the
[printable SOP](docs/Motor-City-Facilitator-SOP.pdf) or its
[editable source](docs/FACILITATOR_SOP.md).
Running a class: [docs/QUICK_START.md](docs/QUICK_START.md) or the
[full facilitator manual](docs/FACILITATOR.md).
Deploying and looking after the server: [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Current milestone

The rebuild is live alongside the original and covers:

- all four original car recipes and economics
- Planning, Manufacturing, Assembly, Quality, Paint, and Done stages
- top-lane-first resource allocation
- one-stage movement and round wait requirements
- two-round paint processing with capacity three
- exact four-for-one resource conversion
- round reset checkpoints and local session recovery
- classic, original 25-round team, and random resource plans
- configurable models, economics, notes, and secure reuse of prior facilitator setups
- live revenue and WIP with penalty economics revealed only after the run
- model-by-model round history, confirmed terminal solo summary, and CSV export
- responsive mouse, touch, and keyboard controls
- independent player factories sharing one facilitator schedule
- create, join, secure rejoin, start, end, roster, and leaderboard flows
- facilitator elapsed clock plus selected WIP and report cutoff rounds
- pre-class scoring setup and customizable per-player round timers
- live ranked leaderboard with ties, movement, podium, throughput, and sortable columns
- optional student identifiers carried through to the results
- on-demand per-player station/resource drill-down, peak and average WIP, and throughput
- cohort low/high/median/mean statistics
- a dependency-free multi-sheet Excel export with Game Details, plus the original CSV
- a projector view showing place, name, turn, and revenue only
- durable facilitator removal and recovery-code reissue for players
- authoritative server commands with optimistic versions and idempotency
- HttpOnly 12-hour sessions, revocation, and rotating recovery codes
- embedded PostgreSQL locally and pooled PostgreSQL in production
- a same-origin hardened runtime with CSP and rate limiting

DNS cutover and retirement of the old game remain deliberately unexecuted. See
[docs/ROADMAP.md](docs/ROADMAP.md).

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

The deployed stack runs directly on the instance: a private Node.js runtime, PostgreSQL on
loopback, and Caddy terminating TLS on `:443`. `deploy/install.sh` prepares a box,
`deploy/update.sh` ships a version and rolls back if it fails its health check, and
`deploy/rollback.sh` steps back one version. Full detail in
[docs/OPERATIONS.md](docs/OPERATIONS.md).

A container image is also available for environments that prefer one: build with
`docker build -t motor-city-supply-game .`. It runs as the unprivileged Node user and exposes
port `3001`. Either way, production requires managed PostgreSQL via `DATABASE_URL` and never
falls back to local disk.

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
  FACILITATOR.md     Running a class session
  OPERATIONS.md      Deploying and looking after the server
  PARITY.md          Preserved gameplay contract
  ROADMAP.md         Approved phased delivery plan
  SECURITY.md        Immediate and target security posture
deploy/
  install.sh         First-time setup, alongside the old game
  update.sh          Ship a version, with automatic rollback
  rollback.sh        Step back one version
```

## Design principles

- Rules live in the pure engine, not React components.
- Every rule change requires an executable test and an explicit parity decision.
- Touch and keyboard interactions are first-class, not fallbacks.
- Secrets, database addresses, and environment URLs never enter source control.
- The old deployment remains available until a tested parallel cutover.
