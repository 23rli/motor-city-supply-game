# HTTP API

Browser calls use same-origin `/api` routes. Session credentials are 12-hour HttpOnly cookies; bearer tokens remain supported for non-browser clients but are never returned in browser JSON.

## Session lifecycle

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/games` | Create a waiting game and facilitator session |
| `POST` | `/api/games/join` | Join a waiting or active game with a unique name |
| `POST` | `/api/games/rejoin` | Recover a participant with game code, name, and recovery code |
| `GET` | `/api/session` | Restore game, participant, roster, and player state |
| `DELETE` | `/api/session` | Revoke the active session immediately |

Create, join, and rejoin return a one-time recovery code in a `Cache-Control: no-store` response. Rejoin rotates it. The application displays it once and stores only a non-sensitive resume hint in local storage. Edge, proxy, and APM configuration must not log these response bodies.

Create accepts enabled models, `classic | evan | random` resource plans, per-model revenue and WIP rates, notes, `penaltyRound`, `endRound`, and an optional round timer. Timer segments are contiguous one-based round ranges with whole-minute durations (60-7200 seconds), and must cover every round through `endRound`. A facilitator may reuse an exact prior setup by supplying that game's join code and facilitator recovery code; models, economics, scoring rounds, timer, and exact resource schedule are copied while notes belong to the new run. Active player payloads redact notes to an empty string, the planned WIP round to `null`, WIP rates to zero, and historical monetary penalty totals to zero.

Example fresh setup:

```json
{
  "facilitatorName": "Professor Morgan",
  "enabledModels": ["blue", "green", "red", "yellow"],
  "resourcePlan": "evan",
  "penaltyRound": 25,
  "endRound": 25,
  "timer": {
    "enabled": true,
    "segments": [
      { "startRound": 1, "endRound": 10, "durationSeconds": 600 },
      { "startRound": 11, "endRound": 25, "durationSeconds": 300 }
    ]
  },
  "notes": "Operations section A"
}
```

## Facilitator

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/games/:gameId/start` | Transition waiting to active |
| `POST` | `/api/games/:gameId/end` | Finish and lock the game |
| `GET` | `/api/games/:gameId/report` | Read the live/final comparison report |
| `GET` | `/api/games/:gameId/export` | Read the full cohort history for workbook/CSV export |
| `GET` | `/api/games/:gameId/participants/:participantId/history` | Read one player's complete round history |
| `POST` | `/api/games/:gameId/optimization` | Start or reuse an optimal-run job |
| `GET` | `/api/games/:gameId/optimization/:jobId` | Poll an optimal-run job |
| `POST` | `/api/games/:gameId/participants/:participantId/recovery` | Rotate a player's recovery code |
| `DELETE` | `/api/games/:gameId/participants/:participantId` | Durably remove a player from active access and reports |

End requires one-based `penaltyRound` and `endRound`. The selected historical WIP round determines penalties; the cutoff round determines reported revenue and throughput.
Ending locks both scores and roster membership. Recovery-code rotation and participant removal return `409 GAME_FINISHED` afterward, while reports, player drill-down, and exports remain readable.
Participant activity timestamps also freeze at finish. Player-accessible final reports reveal scores but omit facilitator notes and every participant's optional student identifier; facilitator reports and exports retain those fields.

Optimal-run routes require a facilitator session. `POST` accepts one-based `penaltyRound` and
`endRound` values from 1 through 100 and returns `202` while work is queued/running. Polling returns
`queued | running | optimal | feasible | failed`. An `optimal` result includes a proof-complete,
engine-replayed synthetic player; `feasible` includes a legal engine-replayed best result when the
solver reaches its time limit. Jobs are cached in process by game and scoring-relevant configuration for
12 hours. They never create participant/database rows and are unavailable to player sessions.

## Player commands

`POST /api/player/commands` accepts:

```json
{
  "expectedVersion": 4,
  "idempotencyKey": "a-client-generated-uuid",
  "command": { "type": "allocate" }
}
```

Command types are `move`, `reposition`, `allocate`, `convert`, `advance`, `reset`, and `timeout`. Each successful command increments only that player's version. A stale version returns `409 STALE_STATE`; replaying the same successful command and key returns the original response without executing again.

`timeout` is accepted only after the server-calculated deadline. It allocates remaining resources and marks the board timed out. While timed out, every mutation except `advance` returns `409 ROUND_TIME_EXPIRED`. `advance` starts the next configured per-player timer. Session and command responses include `roundStartedAt` and `roundTimedOut` so countdown state survives refresh, rejoin, and database restart.

## Persistence

Games hold shared configuration and lifecycle. Participants hold independent factory snapshots and versions. Successful round advances append immutable summaries. Reports read inside a transaction. Idempotency receipts expire after 24 hours and are removed at process startup, hourly, and during commands.

The migration that first introduces durable participant removal treats any already-revoked player row as removed. Earlier releases stored voluntary revocation and facilitator removal identically, so the upgrade deliberately fails closed; later ordinary revocations remain recoverable because the backfill runs only when the new column is created.

Authenticated traffic is rate-limited by hashed session credential so one player cannot consume another player's bucket. Create, join, and rejoin are separately limited by source IP.

Run managed schema changes explicitly with `npm run db:migrate` (source) or `npm run db:migrate:built` (container).