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

## Facilitator

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/games/:gameId/start` | Transition waiting to active |
| `POST` | `/api/games/:gameId/end` | Finish and lock the game |
| `GET` | `/api/games/:gameId/report` | Read the live/final comparison report |

End requires one-based `penaltyRound` and `endRound`. The selected historical WIP round determines penalties; the cutoff round determines reported revenue and throughput.

## Player commands

`POST /api/player/commands` accepts:

```json
{
  "expectedVersion": 4,
  "idempotencyKey": "a-client-generated-uuid",
  "command": { "type": "allocate" }
}
```

Command types are `move`, `allocate`, `convert`, `advance`, and `reset`. Each successful command increments only that player's version. A stale version returns `409 STALE_STATE`; replaying the same successful command and key returns the original response without executing again.

## Persistence

Games hold shared configuration and lifecycle. Participants hold independent factory snapshots and versions. Successful round advances append immutable summaries. Reports read inside a transaction. Idempotency receipts expire after 24 hours and are removed at process startup, hourly, and during commands.

Authenticated traffic is rate-limited by hashed session credential so one player cannot consume another player's bucket. Create, join, and rejoin are separately limited by source IP.

Run managed schema changes explicitly with `npm run db:migrate` (source) or `npm run db:migrate:built` (container).