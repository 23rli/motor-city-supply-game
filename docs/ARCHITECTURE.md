# Architecture

## Current system

- React and TypeScript render the application.
- `src/game` owns deterministic state transitions and reports.
- Components receive state and commands; they do not implement rules.
- Solo state is checkpointed to browser storage after every transition.
- Static car artwork is cropped and compressed to WebP.
- Team players own independent versioned factory snapshots while sharing game configuration, resource schedules, and facilitator lifecycle state.
- Fastify validates every command and applies the shared engine server-side.
- Successful mutations persist idempotency receipts; round advances append report snapshots.
- Browser sessions use short-lived HttpOnly cookies and rotating recovery credentials.
- Transactional reports read complete participant rows and never combine versions from different command states.
- Local development uses embedded PostgreSQL; production uses a pooled TLS connection to managed PostgreSQL.

## Target system

```text
Browser client
  | HTTPS / authenticated session
Application API
  | validated commands and idempotency keys
Authoritative game service
  | transactions
Relational database
```

The server is authoritative for team games. Clients submit commands rather than database-shaped records. A per-player state version rejects stale writes without coupling independent teams.

## Runtime topology

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