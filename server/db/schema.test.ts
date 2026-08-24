import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { INITIAL_SCHEMA_SQL } from './schema'

describe('PostgreSQL schema migration', () => {
  it('preserves pre-security rows while applying additive columns idempotently', async () => {
    const database = new PGlite('memory://')
    try {
      await database.exec(`
        CREATE TABLE games (
          id uuid PRIMARY KEY,
          code varchar(6) NOT NULL UNIQUE,
          status varchar(16) NOT NULL,
          config jsonb NOT NULL,
          facilitator_id uuid NOT NULL,
          created_at timestamptz NOT NULL,
          started_at timestamptz,
          ended_at timestamptz
        );
        CREATE TABLE participants (
          id uuid PRIMARY KEY,
          game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          name varchar(80) NOT NULL,
          normalized_name varchar(80) NOT NULL,
          role varchar(16) NOT NULL,
          token_hash char(64) NOT NULL UNIQUE,
          state jsonb,
          state_version integer NOT NULL DEFAULT 0,
          joined_at timestamptz NOT NULL,
          last_seen_at timestamptz NOT NULL,
          UNIQUE (game_id, normalized_name)
        );
      `)
      const gameId = randomUUID()
      const participantId = randomUUID()
      await database.query(
        `INSERT INTO games
          (id, code, status, config, facilitator_id, created_at)
         VALUES ($1, 'ABC234', 'waiting', '{}'::jsonb, $2, NOW())`,
        [gameId, participantId],
      )
      await database.query(
        `INSERT INTO participants
          (id, game_id, name, normalized_name, role, token_hash,
           state_version, joined_at, last_seen_at)
         VALUES ($1, $2, 'Legacy Host', 'legacy host', 'facilitator', $3, 0, NOW(), NOW())`,
        [participantId, gameId, 'a'.repeat(64)],
      )

      await database.exec(INITIAL_SCHEMA_SQL)
      await database.exec(INITIAL_SCHEMA_SQL)

      const rows = await database.query<{
        code: string
        name: string
        recovery_hash: string | null
        token_expires_at: Date | null
      }>(
        `SELECT g.code, p.name, p.recovery_hash, p.token_expires_at
         FROM games g JOIN participants p ON p.game_id = g.id`,
      )
      expect(rows.rows).toEqual([
        {
          code: 'ABC234',
          name: 'Legacy Host',
          recovery_hash: null,
          token_expires_at: null,
        },
      ])
    } finally {
      await database.close()
    }
  }, 30_000)

  it('backfills legacy revoked players only when removed_at is first introduced', async () => {
    const database = new PGlite('memory://')
    try {
      await database.exec(`
        CREATE TABLE games (
          id uuid PRIMARY KEY,
          code varchar(6) NOT NULL UNIQUE,
          status varchar(16) NOT NULL,
          config jsonb NOT NULL,
          facilitator_id uuid NOT NULL,
          created_at timestamptz NOT NULL,
          started_at timestamptz,
          ended_at timestamptz,
          penalty_round integer,
          end_round integer
        );
        CREATE TABLE participants (
          id uuid PRIMARY KEY,
          game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          name varchar(80) NOT NULL,
          normalized_name varchar(80) NOT NULL,
          role varchar(16) NOT NULL,
          token_hash char(64) NOT NULL UNIQUE,
          recovery_hash char(64),
          token_expires_at timestamptz,
          revoked_at timestamptz,
          state jsonb,
          state_version integer NOT NULL DEFAULT 0,
          identifier varchar(120),
          joined_at timestamptz NOT NULL,
          last_seen_at timestamptz NOT NULL,
          UNIQUE (game_id, normalized_name)
        );
      `)
      const gameId = randomUUID()
      const facilitatorId = randomUUID()
      const legacyPlayerId = randomUUID()
      const laterPlayerId = randomUUID()
      await database.query(
        `INSERT INTO games
          (id, code, status, config, facilitator_id, created_at)
         VALUES ($1, 'ABC234', 'active', '{}'::jsonb, $2, NOW())`,
        [gameId, facilitatorId],
      )
      await database.query(
        `INSERT INTO participants
          (id, game_id, name, normalized_name, role, token_hash, recovery_hash,
           token_expires_at, revoked_at, state_version, joined_at, last_seen_at)
         VALUES
          ($1, $3, 'Legacy Player', 'legacy player', 'player', $4, $5,
           NOW() + INTERVAL '1 hour', NOW() - INTERVAL '1 minute', 0, NOW(), NOW()),
          ($2, $3, 'Later Player', 'later player', 'player', $6, $7,
           NOW() + INTERVAL '1 hour', NULL, 0, NOW(), NOW())`,
        [
          legacyPlayerId,
          laterPlayerId,
          gameId,
          'b'.repeat(64),
          'c'.repeat(64),
          'd'.repeat(64),
          'e'.repeat(64),
        ],
      )

      await database.exec(INITIAL_SCHEMA_SQL)
      await database.query(
        'UPDATE participants SET revoked_at = NOW() WHERE id = $1',
        [laterPlayerId],
      )
      await database.exec(INITIAL_SCHEMA_SQL)

      const rows = await database.query<{
        name: string
        removed_at: Date | null
      }>(
        'SELECT name, removed_at FROM participants ORDER BY name',
      )
      expect(rows.rows).toEqual([
        { name: 'Later Player', removed_at: null },
        { name: 'Legacy Player', removed_at: expect.any(Date) },
      ])
    } finally {
      await database.close()
    }
  }, 30_000)
})