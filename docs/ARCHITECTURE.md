# Architecture

## Current system

- React and TypeScript render the application.
- `src/game` owns deterministic state transitions and reports.
- Components receive state and commands; they do not implement rules.
- Solo state is checkpointed to browser storage after every transition.
- Static car artwork is cropped and compressed to WebP.
- Team players own independent versioned factory snapshots while sharing game configuration, resource schedules, and facilitator lifecycle state.
- Planned final/WIP rounds and timer blocks are persisted at session creation and are included in secure setup reuse.
- Each timed player round has a server-owned start timestamp and timeout flag; refresh or rejoin cannot reset the countdown.
- On timeout, the authoritative command path allocates materials once, locks further mutations, and only accepts round advance.
- Fastify validates every command and applies the shared engine server-side.
- Facilitator-only optimization jobs run HiGHS MILP in one bounded worker thread, then replay every
  solution through the authoritative engine before returning a synthetic student history.
- Optimization jobs are deduplicated by game/configuration, cached in process for 12 hours, limited
  to eight waiting jobs, and never enter participant state, reports, rankings, or exports.
- Successful mutations persist idempotency receipts; round advances append report snapshots.
- Browser sessions use short-lived HttpOnly cookies and rotating recovery credentials.
- Transactional reports read complete participant rows and never combine versions from different command states.
- Local development uses embedded PostgreSQL. The current classroom deployment uses pooled
  loopback PostgreSQL; the application also supports a trusted-TLS managed PostgreSQL target.

## Target system

```text
Browser client
  | HTTPS / authenticated session
Application API
  | validated commands and idempotency keys
Authoritative game service
  | transactions
Relational database

Application API
  | facilitator-only job request
Single optimization worker
  | MILP solution -> authoritative engine replay
Synthetic reference history (not persisted)
```

The server is authoritative for team games. Clients submit commands rather than database-shaped records. A per-player state version rejects stale writes without coupling independent teams.

## Current deployment topology

The classroom deployment serves the SPA and API from one Fastify process behind Caddy on a single
EC2 instance. PostgreSQL runs on the same host, listens only on loopback, and uses SCRAM
authentication. Additive schema migrations run during application startup because
`MIGRATE_ON_START=true`; the deployment health check verifies database access and the timer schema
before declaring the release healthy.

## Target managed topology

The production container serves the SPA and API from one origin behind an HTTPS load balancer. Application tasks run in private subnets and connect to managed PostgreSQL in isolated database subnets. Runtime database credentials and the trusted RDS CA are injected from a managed secret store. Schema migration runs as a one-off task before application rollout.

The embedded database is deliberately refused when `NODE_ENV=production`.

## Data migration

The new schema will preserve games, users, rounds, resource schedules, configured economics, notes, and final reports. Migration scripts will read from a restricted snapshot, validate row counts and totals, and never mutate the legacy database.

## Cutover

1. Deploy an isolated staging stack.
2. Run engine parity and browser workflows.
3. Import a sanitized legacy snapshot and compare reports.
4. Deploy production beside the current host.
5. Pilot facilitator and player sessions.
6. Switch DNS only after approval.
7. Keep a documented rollback window.