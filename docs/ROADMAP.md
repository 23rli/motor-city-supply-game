# Delivery roadmap

## Milestone 0: audit and containment

Status: audited; database ports confirmed closed.

- preserve the existing deployment during the rebuild — done, it still serves `:80`
- rotate the exposed database credential — outstanding, though no longer reachable externally
- restrict database and application ports — done; only HTTP, HTTPS, SSH and ICMP are open
- capture a read-only schema and sanitized migration fixture

## Milestone 1: playable parity slice

Status: implemented in this repository.

- deterministic typed game engine and executable parity tests
- responsive solo factory board
- recipes, conversion, statistics, reset, recovery, and reporting
- configurable classic and random runs
- optimized visual assets and accessible controls
- zero-vulnerability dependency baseline and CI

## Milestone 2: application API

Status: implemented and executable locally.

- define versioned game and command schemas
- add migrations and a local relational database
- implement create, join, rejoin, advance, end, and report endpoints
- validate every input and enforce game-state transitions
- persist idempotency keys instead of using process memory
- add API integration and concurrency tests

## Milestone 3: team and facilitator experience

Status: implemented.

- short human-readable join codes and rotating recovery credentials
- live facilitator roster, progress, revenue, and WIP
- facilitator start, end, timer, and penalty controls
- ranked leaderboard, cohort statistics, and per-round station detail
- projector view for the room, showing place, name, turn, and revenue only
- final comparison report, Excel workbook, and spreadsheet-compatible export
- resilient polling with exponential backoff and visible connection state

## Milestone 4: AWS deployment

Status: deployed in parallel with the original.

- the new game serves HTTPS on the existing hostname; the original keeps HTTP
- Let's Encrypt certificates over TLS-ALPN, renewed automatically
- PostgreSQL on loopback, application bound to loopback behind Caddy
- a private Node.js runtime so the original's system Node is never disturbed
- scripted install, update with automatic rollback, and rollback

Still outstanding: load balancing and redundancy, managed database, secret injection,
alarms, and automated backups. See [OPERATIONS.md](OPERATIONS.md#known-gaps).

## Milestone 5: migration and production cutover

Status: planned.

- pilot the new game with a live class
- validate legacy data mapping against facilitator reports
- performance, accessibility, and browser acceptance testing
- approved DNS cutover and legacy retirement window