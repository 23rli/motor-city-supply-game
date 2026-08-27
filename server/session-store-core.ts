import { randomInt, randomUUID } from 'node:crypto'
import {
  createGame,
  getRoundSummary,
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
  isSessionExpired,
  issueSessionSecrets,
  SESSION_TTL_MS,
} from './session-security'

export type SessionStatus = 'waiting' | 'active' | 'finished'
export type ParticipantRole = 'facilitator' | 'player'

interface SessionRecord {
  id: string
  code: string
  status: SessionStatus
  config: GameConfig
  facilitatorId: string
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  penaltyRound: number | null
  endRound: number | null
}

interface ParticipantRecord {
  id: string
  gameId: string
  name: string
  normalizedName: string
  identifier: string | null
  role: ParticipantRole
  tokenHash: string
  recoveryHash: string
  tokenExpiresAt: string
  revokedAt: string | null
  removedAt: string | null
  state: GameState | null
  stateVersion: number
  joinedAt: string
  lastSeenAt: string
  roundStartedAt: string | null
  roundTimedOut: boolean
}

interface CommandReceipt {
  fingerprint: string
  response: PlayerCommandResult
  createdAt: number
}

export interface PlayerCommandResult {
  state: GameState
  stateVersion: number
  repeated: boolean
  roundStartedAt: string | null
  roundTimedOut: boolean
  serverNow: string
}

export interface IssuedSession {
  token: string
  recoveryCode: string
  game: unknown
  participant: unknown
  state?: GameState
  stateVersion?: number
}

export interface ReadmittedParticipant {
  participantId: string
  name: string
  recoveryCode: string
}

export interface OptimizationInput extends OptimizationRequestInput {
  config: GameConfig
}

/** Why a token stopped working, so the player can be told instead of silently dumped out. */
export type SupersededReason = 'rejoined' | 'removed'

export const SUPERSEDED_MESSAGES: Record<SupersededReason, string> = {
  rejoined: 'You opened this session somewhere else, so this screen was signed out.',
  removed: 'The facilitator removed you from this session.',
}

/** Best-effort UX only - a restart just falls back to the generic expiry message. */
export class SupersededTokens {
  private readonly entries = new Map<string, { reason: SupersededReason, at: number }>()

  note(tokenHash: string, reason: SupersededReason) {
    this.entries.set(tokenHash, { reason, at: Date.now() })
  }

  reasonFor(tokenHash: string) {
    return this.entries.get(tokenHash)?.reason
  }

  prune(olderThanMs: number) {
    const cutoff = Date.now() - olderThanMs
    for (const [hash, entry] of this.entries) {
      if (entry.at < cutoff) this.entries.delete(hash)
    }
  }
}

export interface SessionStore {
  createSession(input: CreateSessionInput): Promise<IssuedSession>
  joinSession(input: JoinSessionInput): Promise<IssuedSession>
  rejoinSession(input: RejoinSessionInput): Promise<IssuedSession>
  getSession(token: string): Promise<unknown>
  revokeSession(token: string): Promise<void>
  startSession(token: string, gameId: string): Promise<unknown>
  endSession(token: string, gameId: string, input: EndSessionInput): Promise<unknown>
  executeCommand(token: string, input: PlayerCommandInput): Promise<PlayerCommandResult>
  getReport(token: string, gameId: string): Promise<unknown>
  getExport(token: string, gameId: string): Promise<unknown>
  getPlayerHistory(token: string, gameId: string, participantId: string): Promise<unknown>
  getOptimizationInput(
    token: string,
    gameId: string,
    input: OptimizationRequestInput,
  ): Promise<OptimizationInput>
  authorizeFacilitator(token: string, gameId: string): Promise<void>
  issueRecoveryCode(
    token: string,
    gameId: string,
    participantId: string,
  ): Promise<ReadmittedParticipant>
  removeParticipant(
    token: string,
    gameId: string,
    participantId: string,
  ): Promise<{ participantId: string, name: string }>
  healthCheck?(): Promise<void>
  cleanupExpiredData?(): Promise<void>
  close?(): Promise<void>
}

export class ApiError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const now = () => new Date().toISOString()
const normalizeName = (name: string) => name.trim().toLocaleLowerCase('en-US')
const clone = <T>(value: T): T => structuredClone(value)
export const toOptimizationConfig = (config: GameConfig): GameConfig => ({
  ...clone(config),
  notes: '',
  timer: { enabled: false, segments: [] },
})

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly sessionIdsByCode = new Map<string, string>()
  private readonly participants = new Map<string, ParticipantRecord>()
  private readonly participantIdsByTokenHash = new Map<string, string>()
  private readonly superseded = new SupersededTokens()
  private readonly receipts = new Map<string, CommandReceipt>()

  async createSession(input: CreateSessionInput): Promise<IssuedSession> {
    const reusedSetup = input.reuse ? this.getReusableSetup(input.reuse) : null
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
    const session: SessionRecord = {
      id: gameId,
      code: this.createUniqueCode(),
      status: 'waiting',
      config: seedState.config,
      facilitatorId,
      createdAt: timestamp,
      startedAt: null,
      endedAt: null,
      penaltyRound: plannedPenaltyRound,
      endRound: plannedEndRound,
    }
    const facilitator: ParticipantRecord = {
      id: facilitatorId,
      gameId,
      name: input.facilitatorName,
      normalizedName: normalizeName(input.facilitatorName),
      identifier: null,
      role: 'facilitator',
      tokenHash: hashSecret(secrets.token),
      recoveryHash: hashSecret(secrets.recoveryCode),
      tokenExpiresAt: secrets.tokenExpiresAt,
      revokedAt: null,
      removedAt: null,
      state: null,
      stateVersion: 0,
      joinedAt: timestamp,
      lastSeenAt: timestamp,
      roundStartedAt: null,
      roundTimedOut: false,
    }

    this.sessions.set(gameId, session)
    this.sessionIdsByCode.set(session.code, gameId)
    this.participants.set(facilitatorId, facilitator)
    this.participantIdsByTokenHash.set(facilitator.tokenHash, facilitatorId)

    return {
      token: secrets.token,
      recoveryCode: secrets.recoveryCode,
      game: this.toSessionSummary(session),
      participant: this.toParticipantSummary(facilitator),
    }
  }

  async joinSession(input: JoinSessionInput): Promise<IssuedSession> {
    const gameId = this.sessionIdsByCode.get(input.code)
    const session = gameId ? this.sessions.get(gameId) : undefined
    if (!session || session.status === 'finished') {
      throw new ApiError(404, 'GAME_NOT_FOUND', 'No active game matches that code.')
    }

    const normalizedName = normalizeName(input.playerName)
    const duplicate = this.getParticipantsForGame(session.id).some(
      (participant) => participant.normalizedName === normalizedName,
    )
    if (duplicate) {
      throw new ApiError(409, 'NAME_IN_USE', 'That name is already in this game.')
    }

    const secrets = issueSessionSecrets()
    const timestamp = now()
    const participant: ParticipantRecord = {
      id: randomUUID(),
      gameId: session.id,
      name: input.playerName,
      normalizedName,
      identifier: input.identifier?.trim() || null,
      role: 'player',
      tokenHash: hashSecret(secrets.token),
      recoveryHash: hashSecret(secrets.recoveryCode),
      tokenExpiresAt: secrets.tokenExpiresAt,
      revokedAt: null,
      removedAt: null,
      state: createGame(session.config),
      stateVersion: 0,
      joinedAt: timestamp,
      lastSeenAt: timestamp,
      roundStartedAt: session.status === 'active'
        && roundTimerDurationSeconds(session.config.timer, 1) !== null
        ? timestamp
        : null,
      roundTimedOut: false,
    }
    this.participants.set(participant.id, participant)
    this.participantIdsByTokenHash.set(participant.tokenHash, participant.id)

    return {
      token: secrets.token,
      recoveryCode: secrets.recoveryCode,
      game: this.toSessionSummary(session, true),
      participant: this.toParticipantSummary(participant),
      state: concealPlayerState(participant.state!),
      stateVersion: participant.stateVersion,
    }
  }

  async rejoinSession(input: RejoinSessionInput): Promise<IssuedSession> {
    const gameId = this.sessionIdsByCode.get(input.code)
    const session = gameId ? this.sessions.get(gameId) : undefined
    if (!session) {
      throw new ApiError(404, 'GAME_NOT_FOUND', 'No game matches that code.')
    }
    const participant = this.getParticipantsForGame(session.id).find(
      (candidate) =>
        candidate.normalizedName === normalizeName(input.playerName)
        && candidate.recoveryHash === hashSecret(input.recoveryCode)
        && !candidate.removedAt,
    )
    if (!participant) {
      throw new ApiError(401, 'INVALID_RECOVERY', 'The recovery details are invalid.')
    }

    this.participantIdsByTokenHash.delete(participant.tokenHash)
    this.superseded.note(participant.tokenHash, 'rejoined')
    const secrets = issueSessionSecrets()
    participant.tokenHash = hashSecret(secrets.token)
    participant.recoveryHash = hashSecret(secrets.recoveryCode)
    participant.tokenExpiresAt = secrets.tokenExpiresAt
    participant.revokedAt = null
    if (session.status !== 'finished') participant.lastSeenAt = now()
    this.participantIdsByTokenHash.set(participant.tokenHash, participant.id)

    return {
      token: secrets.token,
      recoveryCode: secrets.recoveryCode,
      game: this.toSessionSummary(session, participant.role === 'player'),
      participant: this.toParticipantSummary(participant),
      state: participant.state
        ? participant.role === 'player'
          ? concealPlayerState(participant.state)
          : clone(participant.state)
        : undefined,
      stateVersion: participant.stateVersion,
    }
  }

  /** Rotates one participant's recovery code so a facilitator can read it to them aloud. */
  async issueRecoveryCode(
    token: string,
    gameId: string,
    participantId: string,
  ): Promise<ReadmittedParticipant> {
    const { participant, session } = this.authenticateForGame(token, gameId)
    this.requireFacilitator(participant)
    this.requireMutableRoster(session)

    const target = this.participants.get(participantId)
    if (!target || target.gameId !== session.id) {
      throw new ApiError(
        404,
        'PARTICIPANT_NOT_FOUND',
        'That player is not in this session.',
      )
    }

    const { recoveryCode } = issueSessionSecrets()
    target.recoveryHash = hashSecret(recoveryCode)
    target.removedAt = null
    return { participantId: target.id, name: target.name, recoveryCode }
  }

  /** Removes a player mid-game; their screen is told why rather than silently signed out. */
  async removeParticipant(token: string, gameId: string, participantId: string) {
    const { participant, session } = this.authenticateForGame(token, gameId)
    this.requireFacilitator(participant)
    this.requireMutableRoster(session)

    const target = this.participants.get(participantId)
    if (!target || target.gameId !== session.id) {
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
    target.revokedAt = timestamp
    target.removedAt = timestamp
    this.participantIdsByTokenHash.delete(target.tokenHash)
    this.superseded.note(target.tokenHash, 'removed')
    return { participantId: target.id, name: target.name }
  }

  async getSession(token: string) {
    const { participant, session } = this.authenticate(token)
    if (session.status === 'active') {
      this.materializeParticipantTimeout(participant, session)
    }
    if (session.status !== 'finished') participant.lastSeenAt = now()
    return {
      serverNow: now(),
      game: this.toSessionSummary(session, participant.role === 'player'),
      participant: this.toParticipantSummary(participant),
      roster: this.getParticipantsForGame(session.id)
        .filter((member) => !member.removedAt)
        .map((member) => this.toParticipantSummary(member)),
      state: participant.state
        ? participant.role === 'player'
          ? concealPlayerState(participant.state)
          : clone(participant.state)
        : null,
      stateVersion: participant.stateVersion,
    }
  }

  async revokeSession(token: string) {
    const { participant } = this.authenticate(token)
    participant.revokedAt = now()
    this.participantIdsByTokenHash.delete(participant.tokenHash)
  }

  async startSession(token: string, gameId: string) {
    const { participant, session } = this.authenticateForGame(token, gameId)
    this.requireFacilitator(participant)
    if (session.status === 'finished') {
      throw new ApiError(409, 'GAME_FINISHED', 'A finished game cannot be restarted.')
    }
    if (session.status === 'waiting') {
      session.status = 'active'
      const timestamp = now()
      session.startedAt = timestamp
      for (const member of this.getParticipantsForGame(session.id)) {
        if (member.role === 'player' && member.state) {
          member.roundStartedAt = roundTimerDurationSeconds(
            session.config.timer,
            member.state.round + 1,
          ) === null ? null : timestamp
          member.roundTimedOut = false
        }
      }
    }
    return this.toSessionSummary(session)
  }

  async endSession(token: string, gameId: string, input: EndSessionInput) {
    const { participant, session } = this.authenticateForGame(token, gameId)
    this.requireFacilitator(participant)
    if (session.status === 'waiting') {
      throw new ApiError(409, 'GAME_NOT_STARTED', 'Start the game before ending it.')
    }
    if (session.status === 'active') {
      this.materializeExpiredTimers(session)
      this.validateReportRounds(session, input)
      session.status = 'finished'
      session.endedAt = now()
      session.penaltyRound = input.penaltyRound
      session.endRound = input.endRound
    }
    return {
      game: this.toSessionSummary(session),
      report: this.buildReport(session),
    }
  }

  async executeCommand(
    token: string,
    input: PlayerCommandInput,
  ): Promise<PlayerCommandResult> {
    await this.cleanupExpiredData()

    const { participant, session } = this.authenticate(token)
    if (participant.role !== 'player' || !participant.state) {
      throw new ApiError(403, 'PLAYER_REQUIRED', 'Only a player can change a factory state.')
    }
    const receiptKey = `${participant.id}:${input.idempotencyKey}`
    const fingerprint = JSON.stringify({
      expectedVersion: input.expectedVersion,
      command: input.command,
    })
    const existingReceipt = this.receipts.get(receiptKey)
    if (existingReceipt) {
      if (existingReceipt.fingerprint !== fingerprint) {
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'That idempotency key was already used for a different command.',
        )
      }
      const response = clone(existingReceipt.response)
      return {
        ...response,
        state: concealPlayerState(response.state),
        repeated: true,
        serverNow: now(),
      }
    }

    if (session.status !== 'active') {
      throw new ApiError(409, 'GAME_NOT_ACTIVE', 'The facilitator must start this game first.')
    }

    const timeoutMaterialized = this.materializeParticipantTimeout(
      participant,
      session,
    )
    if (timeoutMaterialized) {
      return {
        state: concealPlayerState(participant.state),
        stateVersion: participant.stateVersion,
        repeated: false,
        roundStartedAt: participant.roundStartedAt,
        roundTimedOut: true,
        serverNow: now(),
      }
    }

    if (input.command.type === 'timeout' && participant.roundTimedOut) {
      return {
        state: concealPlayerState(participant.state),
        stateVersion: participant.stateVersion,
        repeated: true,
        roundStartedAt: participant.roundStartedAt,
        roundTimedOut: true,
        serverNow: now(),
      }
    }

    if (input.expectedVersion !== participant.stateVersion) {
      throw new ApiError(
        409,
        'STALE_STATE',
        `Expected player state version ${participant.stateVersion}.`,
      )
    }

    const timerDuration = roundTimerDurationSeconds(
      session.config.timer,
      participant.state.round + 1,
    )
    if (input.command.type === 'timeout') {
      if (timerDuration === null || !participant.roundStartedAt) {
        throw new ApiError(409, 'ROUND_TIMER_DISABLED', 'This round has no timer.')
      }
      if (participant.roundTimedOut) {
        return {
          state: concealPlayerState(participant.state),
          stateVersion: participant.stateVersion,
          repeated: true,
          roundStartedAt: participant.roundStartedAt,
          roundTimedOut: true,
          serverNow: now(),
        }
      }
      throw new ApiError(409, 'ROUND_TIME_REMAINING', 'This round still has time remaining.')
    } else if (participant.roundTimedOut && input.command.type !== 'advance') {
      throw new ApiError(
        409,
        'ROUND_TIME_EXPIRED',
        'Time is up. Advance to the next round.',
      )
    }

    const application = applyPlayerCommand(participant.state, input.command)
    if (application.error) {
      throw new ApiError(422, application.errorCode!, application.error)
    }
    participant.state = application.state
    participant.stateVersion += 1
    const timestamp = now()
    participant.lastSeenAt = timestamp
    if (input.command.type === 'advance') {
      participant.roundTimedOut = false
      participant.roundStartedAt = roundTimerDurationSeconds(
        session.config.timer,
        application.state.round + 1,
      ) === null ? null : timestamp
    }
    const response: PlayerCommandResult = {
      state: concealPlayerState(application.state),
      stateVersion: participant.stateVersion,
      repeated: false,
      roundStartedAt: participant.roundStartedAt,
      roundTimedOut: participant.roundTimedOut,
      serverNow: timestamp,
    }
    this.receipts.set(receiptKey, {
      fingerprint,
      response: clone(response),
      createdAt: Date.now(),
    })
    return response
  }

  async getReport(token: string, gameId: string) {
    const { participant, session } = this.authenticateForGame(token, gameId)
    this.requireReportAccess(participant, session)
    if (session.status === 'active') this.materializeExpiredTimers(session)
    return this.buildReport(session, participant.role === 'player')
  }

  /** Fetched only when a facilitator downloads, so the round history stays out of the poll. */
  async getExport(token: string, gameId: string) {
    const { participant, session } = this.authenticateForGame(token, gameId)
    this.requireFacilitator(participant)
    const report = this.buildReport(session)
    const historyById = new Map(
      this.getParticipantsForGame(session.id)
        .filter((member) => member.role === 'player' && member.state)
        .map((member) => [
          member.id,
          [...member.state!.history, getRoundSummary(member.state!)],
        ]),
    )
    return {
      ...report,
      players: report.players.map((player) => ({
        ...player,
        history: historyById.get(player.id) ?? [],
      })),
    }
  }

  async getPlayerHistory(token: string, gameId: string, participantId: string) {
    const { participant, session } = this.authenticateForGame(token, gameId)
    this.requireFacilitator(participant)
    const target = this.participants.get(participantId)
    if (
      !target
      || target.gameId !== session.id
      || target.role !== 'player'
      || !target.state
      || target.removedAt
    ) {
      throw new ApiError(
        404,
        'PARTICIPANT_NOT_FOUND',
        'That player is not in this session.',
      )
    }
    const metrics = calculatePlayerReport(target.state, {
      penaltyRound: session.penaltyRound,
      endRound: session.endRound,
    })
    return {
      id: target.id,
      name: target.name,
      identifier: target.identifier,
      ...metrics,
      stateVersion: target.stateVersion,
      lastSeenAt: target.lastSeenAt,
      history: [...target.state.history, getRoundSummary(target.state)],
    }
  }

  async getOptimizationInput(
    token: string,
    gameId: string,
    input: OptimizationRequestInput,
  ): Promise<OptimizationInput> {
    const { participant, session } = this.authenticateForGame(token, gameId)
    this.requireFacilitator(participant)
    return { ...input, config: toOptimizationConfig(session.config) }
  }

  async authorizeFacilitator(token: string, gameId: string) {
    const { participant } = this.authenticateForGame(token, gameId)
    this.requireFacilitator(participant)
  }

  async cleanupExpiredData() {
    const sessionCutoff = Date.now() - SESSION_TTL_MS
    const expiredGameIds = new Set<string>()
    for (const [gameId, session] of this.sessions) {
      if (Date.parse(session.createdAt) >= sessionCutoff) continue
      expiredGameIds.add(gameId)
      this.sessions.delete(gameId)
      this.sessionIdsByCode.delete(session.code)
    }
    const expiredParticipantIds = new Set<string>()
    for (const [participantId, participant] of this.participants) {
      if (!expiredGameIds.has(participant.gameId)) continue
      expiredParticipantIds.add(participantId)
      this.participants.delete(participantId)
      this.participantIdsByTokenHash.delete(participant.tokenHash)
    }
    const receiptCutoff = Date.now() - 24 * 60 * 60 * 1_000
    for (const [key, receipt] of this.receipts) {
      const participantId = key.slice(0, key.indexOf(':'))
      if (
        receipt.createdAt < receiptCutoff
        || expiredParticipantIds.has(participantId)
      ) {
        this.receipts.delete(key)
      }
    }
    this.superseded.prune(SESSION_TTL_MS)
  }

  private authenticate(token: string) {
    const tokenHash = hashSecret(token)
    const participantId = this.participantIdsByTokenHash.get(tokenHash)
    const participant = participantId ? this.participants.get(participantId) : undefined
    if (!participant) {
      const reason = this.superseded.reasonFor(tokenHash)
      if (reason) {
        throw new ApiError(401, `SESSION_${reason.toUpperCase()}`, SUPERSEDED_MESSAGES[reason])
      }
      throw new ApiError(401, 'INVALID_SESSION', 'The session token is missing or invalid.')
    }
    if (participant.revokedAt || isSessionExpired(participant.tokenExpiresAt)) {
      this.participantIdsByTokenHash.delete(participant.tokenHash)
      throw new ApiError(
        401,
        'SESSION_EXPIRED',
        'The session has expired. Rejoin with your recovery code.',
      )
    }
    const session = this.sessions.get(participant.gameId)
    if (!session) throw new ApiError(404, 'GAME_NOT_FOUND', 'The game no longer exists.')
    return { participant, session }
  }

  private authenticateForGame(token: string, gameId: string) {
    const context = this.authenticate(token)
    if (context.session.id !== gameId) {
      throw new ApiError(403, 'WRONG_GAME', 'That session token belongs to another game.')
    }
    return context
  }

  private requireFacilitator(participant: ParticipantRecord) {
    if (participant.role !== 'facilitator') {
      throw new ApiError(403, 'FACILITATOR_REQUIRED', 'Only the facilitator can do that.')
    }
  }

  private requireMutableRoster(session: SessionRecord) {
    if (session.status === 'finished') {
      throw new ApiError(
        409,
        'GAME_FINISHED',
        'A finished game has a locked roster and report.',
      )
    }
  }

  private requireReportAccess(
    participant: ParticipantRecord,
    session: SessionRecord,
  ) {
    if (participant.role !== 'facilitator' && session.status !== 'finished') {
      throw new ApiError(
        403,
        'REPORT_FORBIDDEN',
        'Player reports are available after the facilitator ends the game.',
      )
    }
  }

  private validateReportRounds(
    session: SessionRecord,
    input: EndSessionInput,
  ) {
    const maximumRound = Math.max(
      1,
      ...this.getParticipantsForGame(session.id)
        .filter(
          (participant) =>
            participant.role === 'player'
            && participant.state
            && !participant.removedAt,
        )
        .map((participant) => participant.state!.round + 1),
    )
    if (input.penaltyRound > maximumRound || input.endRound > maximumRound) {
      throw new ApiError(
        422,
        'INVALID_REPORT_ROUND',
        `Report rounds cannot exceed round ${maximumRound}.`,
      )
    }
  }

  private getParticipantsForGame(gameId: string) {
    return [...this.participants.values()].filter(
      (participant) => participant.gameId === gameId,
    )
  }

  private createUniqueCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = Array.from(
        { length: 6 },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('')
      if (!this.sessionIdsByCode.has(code)) return code
    }
    throw new ApiError(503, 'CODE_EXHAUSTED', 'Could not allocate a game code.')
  }

  private materializeParticipantTimeout(
    participant: ParticipantRecord,
    session: SessionRecord,
  ) {
    if (!participant.state || participant.role !== 'player' || participant.roundTimedOut) {
      return false
    }
    const duration = roundTimerDurationSeconds(
      session.config.timer,
      participant.state.round + 1,
    )
    if (
      duration === null
      || participant.roundStartedAt === null
      || Date.now() < Date.parse(participant.roundStartedAt) + duration * 1_000
    ) {
      return false
    }
    participant.state = applyPlayerCommand(
      participant.state,
      { type: 'timeout' },
    ).state
    participant.stateVersion += 1
    participant.roundTimedOut = true
    return true
  }

  private materializeExpiredTimers(session: SessionRecord) {
    for (const participant of this.getParticipantsForGame(session.id)) {
      this.materializeParticipantTimeout(participant, session)
    }
  }

  private getReusableSetup(reuse: NonNullable<CreateSessionInput['reuse']>) {
    const gameId = this.sessionIdsByCode.get(reuse.code)
    const session = gameId ? this.sessions.get(gameId) : undefined
    const facilitator = session ? this.participants.get(session.facilitatorId) : undefined
    if (
      !session
      || !facilitator
      || facilitator.removedAt
      || facilitator.recoveryHash !== hashSecret(reuse.recoveryCode)
    ) {
      throw new ApiError(
        401,
        'INVALID_REUSE_CREDENTIALS',
        'The previous facilitator details are invalid.',
      )
    }
    return {
      config: createGame(clone(session.config)).config,
      penaltyRound: session.penaltyRound,
      endRound: session.endRound,
    }
  }

  private toSessionSummary(session: SessionRecord, concealPenalty = false) {
    return {
      id: session.id,
      code: session.code,
      status: session.status,
      config: concealPenalty
        ? concealPlayerConfig(session.config)
        : clone(session.config),
      createdAt: session.createdAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      penaltyRound: concealPenalty ? null : session.penaltyRound,
      endRound: session.endRound,
    }
  }

  private toParticipantSummary(participant: ParticipantRecord) {
    return {
      id: participant.id,
      name: participant.name,
      role: participant.role,
      stateVersion: participant.stateVersion,
      joinedAt: participant.joinedAt,
      lastSeenAt: participant.lastSeenAt,
      roundStartedAt: participant.roundStartedAt,
      roundTimedOut: participant.roundTimedOut,
    }
  }

  private buildReport(session: SessionRecord, playerView = false) {
    const players = this.getParticipantsForGame(session.id)
      .filter(
        (participant) =>
          participant.role === 'player'
          && participant.state
          && !participant.removedAt,
      )
      .map((participant) => {
        const metrics = calculatePlayerReport(participant.state!, {
          penaltyRound: session.penaltyRound,
          endRound: session.endRound,
        })
        return {
          id: participant.id,
          name: participant.name,
          identifier: playerView ? null : participant.identifier,
          ...metrics,
          stateVersion: participant.stateVersion,
          lastSeenAt: participant.lastSeenAt,
        }
      })
      .sort((left, right) => right.projectedScore - left.projectedScore)
    const game = this.toSessionSummary(session)
    if (playerView) game.config = concealConfigNotes(game.config)
    return { game, players }
  }
}