import { randomInt, randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import {
  createGame,
  createRandomResourceSchedule,
} from '../src/game/engine'
import type { GameConfig, GameState } from '../src/game/types'
import type {
  CreateSessionInput,
  EndSessionInput,
  JoinSessionInput,
  PlayerCommandInput,
  RejoinSessionInput,
} from './contracts'
import {
  PGliteSqlClient,
  type SqlClient,
  type SqlExecutor,
} from './db/client'
import { INITIAL_SCHEMA_SQL } from './db/schema'
import { applyPlayerCommand } from './player-command'
import { calculatePlayerReport } from './report'
import {
  hashSecret,
  issueSessionSecrets,
  SESSION_TTL_MS,
} from './session-security'
import {
  ApiError,
  type ParticipantRole,
  type PlayerCommandResult,
  type SessionStatus,
  type SessionStore,
  SUPERSEDED_MESSAGES,
  SupersededTokens,
} from './session-store-core'

interface GameRow {
  id: string
  code: string
  status: SessionStatus
  config: GameConfig | string
  facilitator_id: string
  created_at: Date | string
  started_at: Date | string | null
  ended_at: Date | string | null
  penalty_round: number | null
  end_round: number | null
}

interface ParticipantRow {
  id: string
  game_id: string
  name: string
  normalized_name: string
  role: ParticipantRole
  token_hash: string
  recovery_hash: string
  token_expires_at: Date | string
  revoked_at: Date | string | null
  state: GameState | string | null
  state_version: number
  joined_at: Date | string
  last_seen_at: Date | string
}

interface AuthRow extends ParticipantRow {
  game_code: string
  game_status: SessionStatus
  game_config: GameConfig | string
  game_facilitator_id: string
  game_created_at: Date | string
  game_started_at: Date | string | null
  game_ended_at: Date | string | null
  game_penalty_round: number | null
  game_end_round: number | null
}

interface ReceiptRow {
  fingerprint: string
  response: PlayerCommandResult | string
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const now = () => new Date().toISOString()
const normalizeName = (name: string) => name.trim().toLocaleLowerCase('en-US')
const clone = <T>(value: T): T => structuredClone(value)
const asJson = <T>(value: T | string): T =>
  typeof value === 'string' ? JSON.parse(value) as T : value
const asIso = (value: Date | string | null) =>
  value instanceof Date ? value.toISOString() : value

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object'
  && error !== null
  && 'code' in error
  && error.code === '23505'

export class SqlSessionStore implements SessionStore {
  private readonly superseded = new SupersededTokens()

  private constructor(private readonly client: SqlClient) {}

  static async create(
    client: SqlClient,
    options: { initializeSchema?: boolean } = {},
  ) {
    if (options.initializeSchema ?? true) {
      await client.exec(INITIAL_SCHEMA_SQL)
    }
    return new SqlSessionStore(client)
  }

  async close() {
    await this.client.close()
  }

  async createSession(input: CreateSessionInput) {
    const seedState = createGame({
      enabledModels: input.enabledModels,
      resourceSchedule: input.resourcePlan === 'random'
        ? createRandomResourceSchedule()
        : undefined,
      revenue: input.revenue,
      wipPenalty: input.wipPenalty,
    })
    const gameId = randomUUID()
    const facilitatorId = randomUUID()
    const secrets = issueSessionSecrets()
    const timestamp = now()
    const game: GameRow = {
      id: gameId,
      code: this.createCode(),
      status: 'waiting',
      config: seedState.config,
      facilitator_id: facilitatorId,
      created_at: timestamp,
      started_at: null,
      ended_at: null,
      penalty_round: null,
      end_round: null,
    }
    const facilitator: ParticipantRow = {
      id: facilitatorId,
      game_id: gameId,
      name: input.facilitatorName,
      normalized_name: normalizeName(input.facilitatorName),
      role: 'facilitator',
      token_hash: hashSecret(secrets.token),
      recovery_hash: hashSecret(secrets.recoveryCode),
      token_expires_at: secrets.tokenExpiresAt,
      revoked_at: null,
      state: null,
      state_version: 0,
      joined_at: timestamp,
      last_seen_at: timestamp,
    }

    try {
      await this.client.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO games
            (id, code, status, config, facilitator_id, created_at, started_at,
             ended_at, penalty_round, end_round)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)`,
          [
            game.id,
            game.code,
            game.status,
            JSON.stringify(game.config),
            game.facilitator_id,
            game.created_at,
            game.started_at,
            game.ended_at,
            game.penalty_round,
            game.end_round,
          ],
        )
        await this.insertParticipant(tx, facilitator)
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(503, 'CODE_COLLISION', 'Could not allocate a unique game code.')
      }
      throw error
    }

    return {
      token: secrets.token,
      recoveryCode: secrets.recoveryCode,
      game: this.toSessionSummary(game),
      participant: this.toParticipantSummary(facilitator),
    }
  }

  async joinSession(input: JoinSessionInput) {
    return this.client.transaction(async (tx) => {
      const result = await tx.query<GameRow>(
        `SELECT * FROM games
         WHERE code = $1 AND status IN ('waiting', 'active')
         FOR SHARE`,
        [input.code],
      )
      const game = result.rows[0]
      if (!game) throw new ApiError(404, 'GAME_NOT_FOUND', 'No active game matches that code.')

      const secrets = issueSessionSecrets()
      const timestamp = now()
      const participant: ParticipantRow = {
        id: randomUUID(),
        game_id: game.id,
        name: input.playerName,
        normalized_name: normalizeName(input.playerName),
        role: 'player',
        token_hash: hashSecret(secrets.token),
        recovery_hash: hashSecret(secrets.recoveryCode),
        token_expires_at: secrets.tokenExpiresAt,
        revoked_at: null,
        state: createGame(asJson<GameConfig>(game.config)),
        state_version: 0,
        joined_at: timestamp,
        last_seen_at: timestamp,
      }

      try {
        await this.insertParticipant(tx, participant)
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(409, 'NAME_IN_USE', 'That name is already in this game.')
        }
        throw error
      }

      return {
        token: secrets.token,
        recoveryCode: secrets.recoveryCode,
        game: this.toSessionSummary(game),
        participant: this.toParticipantSummary(participant),
        state: clone(asJson<GameState>(participant.state!)),
        stateVersion: participant.state_version,
      }
    })
  }

  async rejoinSession(input: RejoinSessionInput) {
    return this.client.transaction(async (tx) => {
      const result = await tx.query<AuthRow>(
        `SELECT
           p.*,
           g.code AS game_code,
           g.status AS game_status,
           g.config AS game_config,
           g.facilitator_id AS game_facilitator_id,
           g.created_at AS game_created_at,
           g.started_at AS game_started_at,
           g.ended_at AS game_ended_at,
           g.penalty_round AS game_penalty_round,
           g.end_round AS game_end_round
         FROM participants p
         JOIN games g ON g.id = p.game_id
         WHERE g.code = $1
           AND g.status IN ('waiting', 'active', 'finished')
           AND p.normalized_name = $2
           AND p.recovery_hash = $3
         FOR UPDATE OF p FOR SHARE OF g`,
        [
          input.code,
          normalizeName(input.playerName),
          hashSecret(input.recoveryCode),
        ],
      )
      const row = result.rows[0]
      if (!row) {
        throw new ApiError(401, 'INVALID_RECOVERY', 'The recovery details are invalid.')
      }
      const secrets = issueSessionSecrets()
      const timestamp = now()
      // Remember the retired token so the old screen can say why it was signed out.
      this.superseded.note(row.token_hash, 'rejoined')
      await tx.query(
        `UPDATE participants
         SET token_hash = $1, recovery_hash = $2, token_expires_at = $3,
             revoked_at = NULL, last_seen_at = $4
         WHERE id = $5`,
        [
          hashSecret(secrets.token),
          hashSecret(secrets.recoveryCode),
          secrets.tokenExpiresAt,
          timestamp,
          row.id,
        ],
      )
      row.token_hash = hashSecret(secrets.token)
      row.recovery_hash = hashSecret(secrets.recoveryCode)
      row.token_expires_at = secrets.tokenExpiresAt
      row.revoked_at = null
      row.last_seen_at = timestamp
      const game = this.gameFromAuthRow(row)
      return {
        token: secrets.token,
        recoveryCode: secrets.recoveryCode,
        game: this.toSessionSummary(game),
        participant: this.toParticipantSummary(row),
        state: row.state ? clone(asJson<GameState>(row.state)) : undefined,
        stateVersion: row.state_version,
      }
    })
  }

  async getSession(token: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token)
      const timestamp = now()
      const heartbeat = await tx.query(
        'UPDATE participants SET last_seen_at = $1 WHERE id = $2',
        [timestamp, participant.id],
      )
      if (heartbeat.affectedRows !== 1) {
        throw new ApiError(
          409,
          'SESSION_CHANGED',
          'The participant session changed while it was being restored.',
        )
      }
      participant.last_seen_at = timestamp
      const roster = await tx.query<ParticipantRow>(
        'SELECT * FROM participants WHERE game_id = $1 ORDER BY joined_at, id',
        [game.id],
      )
      return {
        game: this.toSessionSummary(game),
        participant: this.toParticipantSummary(participant),
        roster: roster.rows.map((member) => this.toParticipantSummary(member)),
        state: participant.state ? clone(asJson<GameState>(participant.state)) : null,
        stateVersion: participant.state_version,
      }
    })
  }

  async revokeSession(token: string) {
    await this.client.transaction(async (tx) => {
      const { participant } = await this.authenticate(tx, token, 'command')
      await tx.query(
        'UPDATE participants SET revoked_at = $1 WHERE id = $2',
        [now(), participant.id],
      )
    })
  }

  async startSession(token: string, gameId: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token, 'game')
      this.requireGame(participant, game, gameId)
      this.requireFacilitator(participant)
      if (game.status === 'finished') {
        throw new ApiError(409, 'GAME_FINISHED', 'A finished game cannot be restarted.')
      }
      if (game.status === 'waiting') {
        game.status = 'active'
        game.started_at = now()
        await tx.query(
          'UPDATE games SET status = $1, started_at = $2 WHERE id = $3',
          [game.status, game.started_at, game.id],
        )
      }
      return this.toSessionSummary(game)
    })
  }

  async endSession(token: string, gameId: string, input: EndSessionInput) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token, 'game')
      this.requireGame(participant, game, gameId)
      this.requireFacilitator(participant)
      if (game.status === 'waiting') {
        throw new ApiError(409, 'GAME_NOT_STARTED', 'Start the game before ending it.')
      }
      if (game.status === 'active') {
        await this.validateReportRounds(tx, game.id, input)
        game.status = 'finished'
        game.ended_at = now()
        game.penalty_round = input.penaltyRound
        game.end_round = input.endRound
        await tx.query(
          `UPDATE games
           SET status = $1, ended_at = $2, penalty_round = $3, end_round = $4
           WHERE id = $5`,
          [
            game.status,
            game.ended_at,
            game.penalty_round,
            game.end_round,
            game.id,
          ],
        )
      }
      return {
        game: this.toSessionSummary(game),
        report: await this.buildReport(tx, game),
      }
    })
  }

  async executeCommand(token: string, input: PlayerCommandInput): Promise<PlayerCommandResult> {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token, 'command')
      if (participant.role !== 'player' || !participant.state) {
        throw new ApiError(403, 'PLAYER_REQUIRED', 'Only a player can change a factory state.')
      }
      if (game.status !== 'active') {
        throw new ApiError(409, 'GAME_NOT_ACTIVE', 'The facilitator must start this game first.')
      }

      await this.cleanupExpiredData(tx)

      const fingerprint = JSON.stringify({
        expectedVersion: input.expectedVersion,
        command: input.command,
      })
      const receipts = await tx.query<ReceiptRow>(
        `SELECT fingerprint, response FROM idempotency_receipts
         WHERE participant_id = $1 AND idempotency_key = $2`,
        [participant.id, input.idempotencyKey],
      )
      const receipt = receipts.rows[0]
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) {
          throw new ApiError(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'That idempotency key was already used for a different command.',
          )
        }
        return { ...clone(asJson<PlayerCommandResult>(receipt.response)), repeated: true }
      }

      if (input.expectedVersion !== participant.state_version) {
        throw new ApiError(
          409,
          'STALE_STATE',
          `Expected player state version ${participant.state_version}.`,
        )
      }

      const application = applyPlayerCommand(
        asJson<GameState>(participant.state),
        input.command,
      )
      if (application.error) {
        throw new ApiError(422, application.errorCode!, application.error)
      }
      const stateVersion = participant.state_version + 1
      const timestamp = now()
      const response: PlayerCommandResult = {
        state: clone(application.state),
        stateVersion,
        repeated: false,
      }

      await tx.query(
        `UPDATE participants
         SET state = $1::jsonb, state_version = $2, last_seen_at = $3
         WHERE id = $4`,
        [JSON.stringify(application.state), stateVersion, timestamp, participant.id],
      )
      await tx.query(
        `INSERT INTO idempotency_receipts
          (participant_id, idempotency_key, fingerprint, response, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          participant.id,
          input.idempotencyKey,
          fingerprint,
          JSON.stringify(response),
          timestamp,
        ],
      )

      if (input.command.type === 'advance') {
        const summary = application.state.history.at(-1)
        if (summary) {
          await tx.query(
            `INSERT INTO round_snapshots
              (participant_id, game_id, round_number, summary, state, committed_at)
             VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
             ON CONFLICT (participant_id, round_number) DO NOTHING`,
            [
              participant.id,
              game.id,
              summary.round,
              JSON.stringify(summary),
              JSON.stringify(application.state),
              timestamp,
            ],
          )
        }
      }

      return response
    })
  }

  async getReport(token: string, gameId: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token)
      this.requireGame(participant, game, gameId)
      this.requireReportAccess(participant, game)
      return this.buildReport(tx, game)
    })
  }

  async cleanupExpiredData(client: SqlExecutor = this.client) {
    await client.query(
      `DELETE FROM idempotency_receipts
       WHERE created_at < NOW() - INTERVAL '24 hours'`,
    )
    this.superseded.prune(SESSION_TTL_MS)
  }

  private async authenticate(
    client: SqlExecutor,
    token: string,
    lock: 'none' | 'game' | 'command' = 'none',
  ) {
    const lockClause = lock === 'game'
      ? 'FOR UPDATE OF g'
      : lock === 'command'
        ? 'FOR UPDATE OF p FOR SHARE OF g'
        : ''
    const result = await client.query<AuthRow>(
      `SELECT
         p.*,
         g.code AS game_code,
         g.status AS game_status,
         g.config AS game_config,
         g.facilitator_id AS game_facilitator_id,
         g.created_at AS game_created_at,
         g.started_at AS game_started_at,
         g.ended_at AS game_ended_at,
         g.penalty_round AS game_penalty_round,
         g.end_round AS game_end_round
       FROM participants p
       JOIN games g ON g.id = p.game_id
       WHERE p.token_hash = $1
        AND p.revoked_at IS NULL
        AND p.token_expires_at > NOW()
       ${lockClause}`,
      [hashSecret(token)],
    )
    const row = result.rows[0]
    if (!row) {
      const reason = this.superseded.reasonFor(hashSecret(token))
      if (reason) {
        throw new ApiError(401, `SESSION_${reason.toUpperCase()}`, SUPERSEDED_MESSAGES[reason])
      }
      throw new ApiError(401, 'INVALID_SESSION', 'The session token is missing or invalid.')
    }
    const game = this.gameFromAuthRow(row)
    return { participant: row as ParticipantRow, game }
  }

  private gameFromAuthRow(row: AuthRow): GameRow {
    return {
      id: row.game_id,
      code: row.game_code,
      status: row.game_status,
      config: row.game_config,
      facilitator_id: row.game_facilitator_id,
      created_at: row.game_created_at,
      started_at: row.game_started_at,
      ended_at: row.game_ended_at,
      penalty_round: row.game_penalty_round,
      end_round: row.game_end_round,
    }
  }

  private async insertParticipant(client: SqlExecutor, participant: ParticipantRow) {
    await client.query(
      `INSERT INTO participants
        (id, game_id, name, normalized_name, role, token_hash, recovery_hash,
         token_expires_at, revoked_at, state, state_version, joined_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)`,
      [
        participant.id,
        participant.game_id,
        participant.name,
        participant.normalized_name,
        participant.role,
        participant.token_hash,
        participant.recovery_hash,
        participant.token_expires_at,
        participant.revoked_at,
        participant.state ? JSON.stringify(participant.state) : null,
        participant.state_version,
        participant.joined_at,
        participant.last_seen_at,
      ],
    )
  }

  /** Rotates one participant's recovery code so a facilitator can read it to them aloud. */
  async issueRecoveryCode(token: string, gameId: string, participantId: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token)
      this.requireGame(participant, game, gameId)
      this.requireFacilitator(participant)

      const result = await tx.query<ParticipantRow>(
        `SELECT * FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE`,
        [participantId, gameId],
      )
      const target = result.rows[0]
      if (!target) {
        throw new ApiError(
          404,
          'PARTICIPANT_NOT_FOUND',
          'That player is not in this session.',
        )
      }

      const { recoveryCode } = issueSessionSecrets()
      await tx.query(
        `UPDATE participants SET recovery_hash = $1 WHERE id = $2`,
        [hashSecret(recoveryCode), target.id],
      )
      return { participantId: target.id, name: target.name, recoveryCode }
    })
  }

  /** Removes a player mid-game; their screen is told why rather than silently signed out. */
  async removeParticipant(token: string, gameId: string, participantId: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token)
      this.requireGame(participant, game, gameId)
      this.requireFacilitator(participant)

      const result = await tx.query<ParticipantRow>(
        `SELECT * FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE`,
        [participantId, gameId],
      )
      const target = result.rows[0]
      if (!target) {
        throw new ApiError(
          404,
          'PARTICIPANT_NOT_FOUND',
          'That player is not in this session.',
        )
      }
      if (target.id === participant.id) {
        throw new ApiError(
          409,
          'CANNOT_REMOVE_SELF',
          'You cannot remove yourself from the session.',
        )
      }

      await tx.query(
        `UPDATE participants SET revoked_at = $1 WHERE id = $2`,
        [now(), target.id],
      )
      this.superseded.note(target.token_hash, 'removed')
      return { participantId: target.id, name: target.name }
    })
  }

  private async buildReport(client: SqlExecutor, game: GameRow) {
    const result = await client.query<ParticipantRow>(
      `SELECT p.* FROM participants p
       WHERE p.game_id = $1 AND p.role = 'player'
       ORDER BY p.joined_at, p.id
       FOR SHARE OF p`,
      [game.id],
    )
    const players = result.rows
      .filter((participant) => participant.state)
      .map((participant) => {
        const state = asJson<GameState>(participant.state!)
        const metrics = calculatePlayerReport(state, {
          penaltyRound: game.penalty_round,
          endRound: game.end_round,
        })
        return {
          id: participant.id,
          name: participant.name,
          ...metrics,
          stateVersion: participant.state_version,
          lastSeenAt: asIso(participant.last_seen_at),
        }
      })
      .sort((left, right) => right.projectedScore - left.projectedScore)
    return { game: this.toSessionSummary(game), players }
  }

  private requireGame(participant: ParticipantRow, game: GameRow, gameId: string) {
    if (participant.game_id !== gameId || game.id !== gameId) {
      throw new ApiError(403, 'WRONG_GAME', 'That session token belongs to another game.')
    }
  }

  private requireFacilitator(participant: ParticipantRow) {
    if (participant.role !== 'facilitator') {
      throw new ApiError(403, 'FACILITATOR_REQUIRED', 'Only the facilitator can do that.')
    }
  }

  private requireReportAccess(
    participant: ParticipantRow,
    game: GameRow,
  ) {
    if (participant.role !== 'facilitator' && game.status !== 'finished') {
      throw new ApiError(
        403,
        'REPORT_FORBIDDEN',
        'Player reports are available after the facilitator ends the game.',
      )
    }
  }

  private async validateReportRounds(
    client: SqlExecutor,
    gameId: string,
    input: EndSessionInput,
  ) {
    const result = await client.query<{ state: GameState | string | null }>(
      `SELECT state FROM participants
       WHERE game_id = $1 AND role = 'player'
       FOR SHARE`,
      [gameId],
    )
    const maximumRound = Math.max(
      1,
      ...result.rows
        .filter((row) => row.state)
        .map((row) => asJson<GameState>(row.state!).round + 1),
    )
    if (input.penaltyRound > maximumRound || input.endRound > maximumRound) {
      throw new ApiError(
        422,
        'INVALID_REPORT_ROUND',
        `Report rounds cannot exceed round ${maximumRound}.`,
      )
    }
  }

  private createCode() {
    return Array.from(
      { length: 6 },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('')
  }

  private toSessionSummary(game: GameRow) {
    return {
      id: game.id,
      code: game.code,
      status: game.status,
      config: clone(asJson<GameConfig>(game.config)),
      createdAt: asIso(game.created_at),
      startedAt: asIso(game.started_at),
      endedAt: asIso(game.ended_at),
      penaltyRound: game.penalty_round,
      endRound: game.end_round,
    }
  }

  private toParticipantSummary(participant: ParticipantRow) {
    return {
      id: participant.id,
      name: participant.name,
      role: participant.role,
      stateVersion: participant.state_version,
      joinedAt: asIso(participant.joined_at),
      lastSeenAt: asIso(participant.last_seen_at),
    }
  }
}

export class PGliteSessionStore {
  static create(client: PGlite = new PGlite('memory://')) {
    return SqlSessionStore.create(new PGliteSqlClient(client))
  }
}