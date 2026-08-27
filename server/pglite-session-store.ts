import { randomInt, randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import {
  createGame,
  getRoundSummary,
  normalizeGameState,
} from '../src/game/engine'
import type { GameConfig, GameState } from '../src/game/types'
import type {
  CreateSessionInput,
  EndSessionInput,
  JoinSessionInput,
  OptimizationRequestInput,
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
import {
  concealConfigNotes,
  concealPlayerConfig,
  concealPlayerState,
} from './player-view'
import { calculatePlayerReport } from './report'
import { defaultEndRound, originalTimerConfig } from '../src/game/timer'
import { roundTimerDurationSeconds } from '../src/game/timer'
import {
  hashSecret,
  issueSessionSecrets,
  SESSION_TTL_MS,
} from './session-security'
import {
  ApiError,
  type OptimizationInput,
  type ParticipantRole,
  type PlayerCommandResult,
  type SessionStatus,
  type SessionStore,
  SUPERSEDED_MESSAGES,
  SupersededTokens,
  toOptimizationConfig,
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
  identifier: string | null
  role: ParticipantRole
  token_hash: string
  recovery_hash: string
  token_expires_at: Date | string
  revoked_at: Date | string | null
  removed_at: Date | string | null
  state: GameState | string | null
  state_version: number
  joined_at: Date | string
  last_seen_at: Date | string
  round_started_at: Date | string | null
  round_timed_out: boolean
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

  async healthCheck() {
    await this.client.query(
      'SELECT round_started_at, round_timed_out FROM participants LIMIT 0',
    )
  }

  async createSession(input: CreateSessionInput) {
    let reusedSetup: {
      config: GameConfig
      penaltyRound: number | null
      endRound: number | null
    } | null = null
    if (input.reuse) {
      const reusable = await this.client.query<{
        config: GameConfig | string
        penalty_round: number | null
        end_round: number | null
      }>(
        `SELECT g.config, g.penalty_round, g.end_round
         FROM games g
         JOIN participants p ON p.id = g.facilitator_id
         WHERE g.code = $1
           AND p.recovery_hash = $2
           AND p.removed_at IS NULL`,
        [input.reuse.code, hashSecret(input.reuse.recoveryCode)],
      )
      if (!reusable.rows[0]) {
        throw new ApiError(
          401,
          'INVALID_REUSE_CREDENTIALS',
          'The previous facilitator details are invalid.',
        )
      }
      reusedSetup = {
        config: createGame(asJson<GameConfig>(reusable.rows[0].config)).config,
        penaltyRound: reusable.rows[0].penalty_round,
        endRound: reusable.rows[0].end_round,
      }
    }
    const plannedEndRound = reusedSetup?.endRound
      ?? input.endRound
      ?? defaultEndRound(input.resourcePlan)
    const plannedPenaltyRound = reusedSetup?.penaltyRound
      ?? input.penaltyRound
      ?? plannedEndRound
    const timer = reusedSetup
      ? reusedSetup.config.timer.segments.length
        ? reusedSetup.config.timer
        : originalTimerConfig(plannedEndRound)
      : input.timer ?? originalTimerConfig(plannedEndRound)
    const seedState = createGame(reusedSetup
      ? { ...reusedSetup.config, notes: input.notes, timer }
      : {
          enabledModels: input.enabledModels,
          resourcePlan: input.resourcePlan,
          revenue: input.revenue,
          wipPenalty: input.wipPenalty,
          notes: input.notes,
          timer,
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
      penalty_round: plannedPenaltyRound,
      end_round: plannedEndRound,
    }
    const facilitator: ParticipantRow = {
      id: facilitatorId,
      game_id: gameId,
      name: input.facilitatorName,
      normalized_name: normalizeName(input.facilitatorName),
      identifier: null,
      role: 'facilitator',
      token_hash: hashSecret(secrets.token),
      recovery_hash: hashSecret(secrets.recoveryCode),
      token_expires_at: secrets.tokenExpiresAt,
      revoked_at: null,
      removed_at: null,
      state: null,
      state_version: 0,
      joined_at: timestamp,
      last_seen_at: timestamp,
      round_started_at: null,
      round_timed_out: false,
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
      const state = createGame(asJson<GameConfig>(game.config))
      const participant: ParticipantRow = {
        id: randomUUID(),
        game_id: game.id,
        name: input.playerName,
        normalized_name: normalizeName(input.playerName),
        identifier: input.identifier?.trim() || null,
        role: 'player',
        token_hash: hashSecret(secrets.token),
        recovery_hash: hashSecret(secrets.recoveryCode),
        token_expires_at: secrets.tokenExpiresAt,
        revoked_at: null,
        removed_at: null,
        state,
        state_version: 0,
        joined_at: timestamp,
        last_seen_at: timestamp,
        round_started_at: game.status === 'active'
          && roundTimerDurationSeconds(state.config.timer, 1) !== null
          ? timestamp
          : null,
        round_timed_out: false,
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
        game: this.toSessionSummary(game, true),
        participant: this.toParticipantSummary(participant),
        state: concealPlayerState(asJson<GameState>(participant.state!)),
        stateVersion: participant.state_version,
      }
    })
  }

  async rejoinSession(input: RejoinSessionInput) {
    return this.client.transaction(async (tx) => {
      const locator = await tx.query<{ game_id: string }>(
        `SELECT p.game_id
         FROM participants p
         JOIN games g ON g.id = p.game_id
         WHERE g.code = $1
           AND g.status IN ('waiting', 'active', 'finished')
           AND p.normalized_name = $2
           AND p.recovery_hash = $3
           AND p.removed_at IS NULL`,
        [
          input.code,
          normalizeName(input.playerName),
          hashSecret(input.recoveryCode),
        ],
      )
      const gameId = locator.rows[0]?.game_id
      if (!gameId) {
        throw new ApiError(401, 'INVALID_RECOVERY', 'The recovery details are invalid.')
      }

      const games = await tx.query<GameRow>(
        `SELECT * FROM games
         WHERE id = $1 AND status IN ('waiting', 'active', 'finished')
         FOR SHARE`,
        [gameId],
      )
      const game = games.rows[0]
      if (!game) {
        throw new ApiError(401, 'INVALID_RECOVERY', 'The recovery details are invalid.')
      }
      const participants = await tx.query<ParticipantRow>(
        `SELECT * FROM participants
         WHERE game_id = $1
           AND normalized_name = $2
           AND recovery_hash = $3
           AND removed_at IS NULL
         FOR UPDATE`,
        [
          game.id,
          normalizeName(input.playerName),
          hashSecret(input.recoveryCode),
        ],
      )
      const row = participants.rows[0]
      if (!row) {
        throw new ApiError(401, 'INVALID_RECOVERY', 'The recovery details are invalid.')
      }
      const secrets = issueSessionSecrets()
      const timestamp = game.status === 'finished'
        ? asIso(row.last_seen_at)!
        : now()
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
      return {
        token: secrets.token,
        recoveryCode: secrets.recoveryCode,
        game: this.toSessionSummary(game, row.role === 'player'),
        participant: this.toParticipantSummary(row),
        state: row.state
          ? row.role === 'player'
            ? concealPlayerState(asJson<GameState>(row.state))
            : clone(asJson<GameState>(row.state))
          : undefined,
        stateVersion: row.state_version,
      }
    })
  }

  async getSession(token: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token, 'command')
      if (game.status === 'active') {
        await this.materializeParticipantTimeout(tx, participant, game)
      }
      if (game.status !== 'finished') {
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
      }
      const roster = await tx.query<ParticipantRow>(
        `SELECT * FROM participants
         WHERE game_id = $1 AND removed_at IS NULL
         ORDER BY joined_at, id`,
        [game.id],
      )
      return {
        serverNow: now(),
        game: this.toSessionSummary(game, participant.role === 'player'),
        participant: this.toParticipantSummary(participant),
        roster: roster.rows.map((member) => this.toParticipantSummary(member)),
        state: participant.state
          ? participant.role === 'player'
            ? concealPlayerState(asJson<GameState>(participant.state))
            : clone(asJson<GameState>(participant.state))
          : null,
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
        const config = createGame(asJson<GameConfig>(game.config)).config
        const roundStartedAt = roundTimerDurationSeconds(config.timer, 1) === null
          ? null
          : game.started_at
        await tx.query(
          `UPDATE participants
           SET round_started_at = $1, round_timed_out = FALSE
           WHERE game_id = $2 AND role = 'player'`,
          [roundStartedAt, game.id],
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
        await this.materializeExpiredTimers(tx, game)
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
        const response = clone(asJson<PlayerCommandResult>(receipt.response))
        return {
          ...response,
          state: concealPlayerState(response.state),
          repeated: true,
          roundStartedAt: response.roundStartedAt
            ?? asIso(participant.round_started_at),
          roundTimedOut: response.roundTimedOut
            ?? participant.round_timed_out,
          serverNow: now(),
        }
      }

      if (game.status !== 'active') {
        throw new ApiError(409, 'GAME_NOT_ACTIVE', 'The facilitator must start this game first.')
      }

      const timeoutMaterialized = await this.materializeParticipantTimeout(
        tx,
        participant,
        game,
      )
      if (timeoutMaterialized) {
        return {
          state: concealPlayerState(asJson<GameState>(participant.state!)),
          stateVersion: participant.state_version,
          repeated: false,
          roundStartedAt: asIso(participant.round_started_at),
          roundTimedOut: true,
          serverNow: now(),
        }
      }

      if (input.command.type === 'timeout' && participant.round_timed_out) {
        return {
          state: concealPlayerState(asJson<GameState>(participant.state!)),
          stateVersion: participant.state_version,
          repeated: true,
          roundStartedAt: asIso(participant.round_started_at),
          roundTimedOut: true,
          serverNow: now(),
        }
      }

      if (input.expectedVersion !== participant.state_version) {
        throw new ApiError(
          409,
          'STALE_STATE',
          `Expected player state version ${participant.state_version}.`,
        )
      }

      const currentState = normalizeGameState(asJson<GameState>(participant.state))
      const config = createGame(asJson<GameConfig>(game.config)).config
      const timerDuration = roundTimerDurationSeconds(
        config.timer,
        currentState.round + 1,
      )
      if (input.command.type === 'timeout') {
        if (timerDuration === null || !participant.round_started_at) {
          throw new ApiError(409, 'ROUND_TIMER_DISABLED', 'This round has no timer.')
        }
        throw new ApiError(409, 'ROUND_TIME_REMAINING', 'This round still has time remaining.')
      } else if (participant.round_timed_out && input.command.type !== 'advance') {
        throw new ApiError(
          409,
          'ROUND_TIME_EXPIRED',
          'Time is up. Advance to the next round.',
        )
      }

      const application = applyPlayerCommand(
        normalizeGameState(asJson<GameState>(participant.state)),
        input.command,
      )
      if (application.error) {
        throw new ApiError(422, application.errorCode!, application.error)
      }
      const stateVersion = participant.state_version + 1
      const timestamp = now()
      let roundStartedAt = asIso(participant.round_started_at)
      let roundTimedOut = participant.round_timed_out
      if (input.command.type === 'advance') {
        roundTimedOut = false
        roundStartedAt = roundTimerDurationSeconds(
          config.timer,
          application.state.round + 1,
        ) === null ? null : timestamp
      }
      const response: PlayerCommandResult = {
        state: concealPlayerState(application.state),
        stateVersion,
        repeated: false,
        roundStartedAt,
        roundTimedOut,
        serverNow: timestamp,
      }

      await tx.query(
        `UPDATE participants
         SET state = $1::jsonb, state_version = $2, last_seen_at = $3,
             round_started_at = $4, round_timed_out = $5
         WHERE id = $6`,
        [
          JSON.stringify(application.state),
          stateVersion,
          timestamp,
          roundStartedAt,
          roundTimedOut,
          participant.id,
        ],
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
      const { participant, game } = await this.authenticate(tx, token, 'command')
      this.requireGame(participant, game, gameId)
      this.requireReportAccess(participant, game)
      if (game.status === 'active') await this.materializeExpiredTimers(tx, game)
      return this.buildReport(tx, game, participant.role === 'player')
    })
  }

  /** Fetched only when a facilitator downloads, so the round history stays out of the poll. */
  async getExport(token: string, gameId: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token, 'command')
      this.requireGame(participant, game, gameId)
      this.requireFacilitator(participant)
      if (game.status === 'active') await this.materializeExpiredTimers(tx, game)

      const report = await this.buildReport(tx, game)
      const rows = await tx.query<ParticipantRow>(
        `SELECT id, state FROM participants
         WHERE game_id = $1 AND role = 'player' AND state IS NOT NULL`,
        [game.id],
      )
      const historyById = new Map(
        rows.rows
          .filter((row) => row.state !== null)
          .map((row) => {
            const state = normalizeGameState(asJson<GameState>(row.state as string | GameState))
            return [row.id, [...state.history, getRoundSummary(state)]] as const
          }),
      )
      return {
        ...report,
        players: report.players.map((player) => ({
          ...player,
          history: historyById.get(player.id) ?? [],
        })),
      }
    })
  }

  async getPlayerHistory(token: string, gameId: string, participantId: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token, 'command')
      this.requireGame(participant, game, gameId)
      this.requireFacilitator(participant)
      if (game.status === 'active') await this.materializeExpiredTimers(tx, game)
      const result = await tx.query<ParticipantRow>(
        `SELECT * FROM participants
         WHERE id = $1 AND game_id = $2 AND role = 'player'
           AND state IS NOT NULL AND removed_at IS NULL
         FOR SHARE`,
        [participantId, gameId],
      )
      const target = result.rows[0]
      if (!target || !target.state) {
        throw new ApiError(
          404,
          'PARTICIPANT_NOT_FOUND',
          'That player is not in this session.',
        )
      }
      const state = normalizeGameState(asJson<GameState>(target.state))
      const metrics = calculatePlayerReport(state, {
        penaltyRound: game.penalty_round,
        endRound: game.end_round,
      })
      return {
        id: target.id,
        name: target.name,
        identifier: target.identifier ?? null,
        ...metrics,
        stateVersion: target.state_version,
        lastSeenAt: asIso(target.last_seen_at),
        history: [...state.history, getRoundSummary(state)],
      }
    })
  }

  async getOptimizationInput(
    token: string,
    gameId: string,
    input: OptimizationRequestInput,
  ): Promise<OptimizationInput> {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token, 'command')
      this.requireGame(participant, game, gameId)
      this.requireFacilitator(participant)
      return {
        ...input,
        config: toOptimizationConfig(asJson<GameConfig>(game.config)),
      }
    })
  }

  async authorizeFacilitator(token: string, gameId: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token, 'command')
      this.requireGame(participant, game, gameId)
      this.requireFacilitator(participant)
    })
  }

  async cleanupExpiredData(client: SqlExecutor = this.client) {
    await client.query(
      'DELETE FROM games WHERE created_at < $1',
      [new Date(Date.now() - SESSION_TTL_MS).toISOString()],
    )
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
    const tokenHash = hashSecret(token)
    const invalidSession = (): never => {
      const reason = this.superseded.reasonFor(tokenHash)
      if (reason) {
        throw new ApiError(401, `SESSION_${reason.toUpperCase()}`, SUPERSEDED_MESSAGES[reason])
      }
      throw new ApiError(401, 'INVALID_SESSION', 'The session token is missing or invalid.')
    }

    if (lock === 'none') {
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
          AND p.removed_at IS NULL
          AND p.token_expires_at > NOW()`,
        [tokenHash],
      )
      const row = result.rows[0]
      if (!row) return invalidSession()
      return { participant: row as ParticipantRow, game: this.gameFromAuthRow(row) }
    }

    const locator = await client.query<{ game_id: string }>(
      'SELECT game_id FROM participants WHERE token_hash = $1',
      [tokenHash],
    )
    const gameId = locator.rows[0]?.game_id
    if (!gameId) return invalidSession()

    const gameLock = lock === 'game' ? 'FOR UPDATE' : 'FOR SHARE'
    const games = await client.query<GameRow>(
      `SELECT * FROM games WHERE id = $1 ${gameLock}`,
      [gameId],
    )
    const game = games.rows[0]
    if (!game) {
      throw new ApiError(404, 'GAME_NOT_FOUND', 'The game no longer exists.')
    }
    const participants = await client.query<ParticipantRow>(
      `SELECT * FROM participants
       WHERE token_hash = $1
         AND game_id = $2
         AND revoked_at IS NULL
         AND removed_at IS NULL
         AND token_expires_at > NOW()
       FOR UPDATE`,
      [tokenHash, game.id],
    )
    const participant = participants.rows[0]
    if (!participant) return invalidSession()
    return { participant, game }
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
        (id, game_id, name, normalized_name, identifier, role, token_hash, recovery_hash,
         token_expires_at, revoked_at, removed_at, state, state_version, joined_at, last_seen_at,
         round_started_at, round_timed_out)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17)`,
      [
        participant.id,
        participant.game_id,
        participant.name,
        participant.normalized_name,
        participant.identifier,
        participant.role,
        participant.token_hash,
        participant.recovery_hash,
        participant.token_expires_at,
        participant.revoked_at,
        participant.removed_at,
        participant.state ? JSON.stringify(participant.state) : null,
        participant.state_version,
        participant.joined_at,
        participant.last_seen_at,
        participant.round_started_at,
        participant.round_timed_out,
      ],
    )
  }

  /** Rotates one participant's recovery code so a facilitator can read it to them aloud. */
  async issueRecoveryCode(token: string, gameId: string, participantId: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token, 'game')
      this.requireGame(participant, game, gameId)
      this.requireFacilitator(participant)
      this.requireMutableRoster(game)

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
        `UPDATE participants SET recovery_hash = $1, removed_at = NULL WHERE id = $2`,
        [hashSecret(recoveryCode), target.id],
      )
      return { participantId: target.id, name: target.name, recoveryCode }
    })
  }

  /** Removes a player mid-game; their screen is told why rather than silently signed out. */
  async removeParticipant(token: string, gameId: string, participantId: string) {
    return this.client.transaction(async (tx) => {
      const { participant, game } = await this.authenticate(tx, token, 'game')
      this.requireGame(participant, game, gameId)
      this.requireFacilitator(participant)
      this.requireMutableRoster(game)

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

      const timestamp = now()
      await tx.query(
        `UPDATE participants SET revoked_at = $1, removed_at = $1 WHERE id = $2`,
        [timestamp, target.id],
      )
      this.superseded.note(target.token_hash, 'removed')
      return { participantId: target.id, name: target.name }
    })
  }

  private async buildReport(
    client: SqlExecutor,
    game: GameRow,
    playerView = false,
  ) {
    const result = await client.query<ParticipantRow>(
      `SELECT p.* FROM participants p
        WHERE p.game_id = $1 AND p.role = 'player' AND p.removed_at IS NULL
       ORDER BY p.joined_at, p.id
       FOR SHARE OF p`,
      [game.id],
    )
    const players = result.rows
      .filter((participant) => participant.state)
      .map((participant) => {
        const state = normalizeGameState(asJson<GameState>(participant.state!))
        const metrics = calculatePlayerReport(state, {
          penaltyRound: game.penalty_round,
          endRound: game.end_round,
        })
        return {
          id: participant.id,
          name: participant.name,
          identifier: playerView ? null : participant.identifier ?? null,
          ...metrics,
          stateVersion: participant.state_version,
          lastSeenAt: asIso(participant.last_seen_at),
        }
      })
      .sort((left, right) => right.projectedScore - left.projectedScore)
    const summary = this.toSessionSummary(game)
    if (playerView) summary.config = concealConfigNotes(summary.config)
    return { game: summary, players }
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

  private requireMutableRoster(game: GameRow) {
    if (game.status === 'finished') {
      throw new ApiError(
        409,
        'GAME_FINISHED',
        'A finished game has a locked roster and report.',
      )
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
        WHERE game_id = $1 AND role = 'player' AND removed_at IS NULL
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

  private async materializeParticipantTimeout(
    client: SqlExecutor,
    participant: ParticipantRow,
    game: GameRow,
  ) {
    if (!participant.state || participant.role !== 'player' || participant.round_timed_out) {
      return false
    }
    const state = normalizeGameState(asJson<GameState>(participant.state))
    const config = createGame(asJson<GameConfig>(game.config)).config
    const duration = roundTimerDurationSeconds(config.timer, state.round + 1)
    if (
      duration === null
      || participant.round_started_at === null
      || Date.now() < Date.parse(asIso(participant.round_started_at)!) + duration * 1_000
    ) {
      return false
    }
    const timedOutState = applyPlayerCommand(state, { type: 'timeout' }).state
    const stateVersion = participant.state_version + 1
    await client.query(
      `UPDATE participants
       SET state = $1::jsonb, state_version = $2, round_timed_out = TRUE
       WHERE id = $3`,
      [JSON.stringify(timedOutState), stateVersion, participant.id],
    )
    participant.state = timedOutState
    participant.state_version = stateVersion
    participant.round_timed_out = true
    return true
  }

  private async materializeExpiredTimers(client: SqlExecutor, game: GameRow) {
    const result = await client.query<ParticipantRow>(
      `SELECT * FROM participants
       WHERE game_id = $1 AND role = 'player' AND state IS NOT NULL
         AND removed_at IS NULL
       FOR UPDATE`,
      [game.id],
    )
    for (const participant of result.rows) {
      await this.materializeParticipantTimeout(client, participant, game)
    }
  }

  private createCode() {
    return Array.from(
      { length: 6 },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('')
  }

  private toSessionSummary(game: GameRow, concealPenalty = false) {
    return {
      id: game.id,
      code: game.code,
      status: game.status,
      config: concealPenalty
        ? concealPlayerConfig(createGame(asJson<GameConfig>(game.config)).config)
        : createGame(asJson<GameConfig>(game.config)).config,
      createdAt: asIso(game.created_at),
      startedAt: asIso(game.started_at),
      endedAt: asIso(game.ended_at),
      penaltyRound: concealPenalty ? null : game.penalty_round,
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
      roundStartedAt: asIso(participant.round_started_at),
      roundTimedOut: participant.round_timed_out,
    }
  }
}

export class PGliteSessionStore {
  static create(client: PGlite = new PGlite('memory://')) {
    return SqlSessionStore.create(new PGliteSqlClient(client))
  }
}