# Delivery roadmap

## Milestone 0: audit and containment

Status: audited; AWS containment still requires account-owner action.

- preserve the existing deployment during the rebuild
- rotate the exposed database credential
- restrict database and application ports
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

Status: implemented for local/staging pilots.

- short human-readable join codes and rotating recovery credentials
- live facilitator roster, progress, revenue, and WIP
- facilitator start, end, timer, and penalty controls
- final comparison report and spreadsheet-compatible export
- resilient polling with exponential backoff and visible connection state

## Milestone 4: AWS staging

Status: application runtime prepared; AWS resources are not deployed.

- provision HTTPS load balancing, private application networking, managed PostgreSQL, secret injection, and protected deployment environments
- HTTPS-only edge and API endpoints
- private database networking and managed secrets
- least-privilege identities, logs, metrics, alarms, and backups
- run the explicit migration task before rolling out the application task

## Milestone 5: migration and production cutover

Status: planned.

- validate legacy data mapping against facilitator reports
- performance, accessibility, and browser acceptance testing
- pilot game with rollback plan
- approved DNS cutover and legacy retirement window