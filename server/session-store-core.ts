import { randomInt, randomUUID } from 'node:crypto'
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
import { applyPlayerCommand } from './player-command'
import { calculatePlayerReport } from './report'
import {
  hashSecret,
  isSessionExpired,
  issueSessionSecrets,
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
  role: ParticipantRole
  tokenHash: string
  recoveryHash: string
  tokenExpiresAt: string
  revokedAt: string | null
  state: GameState | null
  stateVersion: number
  joinedAt: string
  lastSeenAt: string
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
}

export interface IssuedSession {
  token: string
  recoveryCode: string
  game: unknown
  participant: unknown
  state?: GameState
  stateVersion?: number
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

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly sessionIdsByCode = new Map<string, string>()
  private readonly participants = new Map<string, ParticipantRecord>()
  private readonly participantIdsByTokenHash = new Map<string, string>()
  private readonly receipts = new Map<string, CommandReceipt>()

  async createSession(input: CreateSessionInput): Promise<IssuedSession> {
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
    const session: SessionRecord = {
      id: gameId,
      code: this.createUniqueCode(),
      status: 'waiting',
      config: seedState.config,
      facilitatorId,
      createdAt: timestamp,
      startedAt: null,
      endedAt: null,
      penaltyRound: null,
      endRound: null,
    }
    const facilitator: ParticipantRecord = {
      id: facilitatorId,
      gameId,
      name: input.facilitatorName,
      normalizedName: normalizeName(input.facilitatorName),
      role: 'facilitator',
      tokenHash: hashSecret(secrets.token),
      recoveryHash: hashSecret(secrets.recoveryCode),
      tokenExpiresAt: secrets.tokenExpiresAt,
      revokedAt: null,
      state: null,
      stateVersion: 0,
      joinedAt: timestamp,
      lastSeenAt: timestamp,
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
      role: 'player',
      tokenHash: hashSecret(secrets.token),
      recoveryHash: hashSecret(secrets.recoveryCode),
      tokenExpiresAt: secrets.tokenExpiresAt,
      revokedAt: null,
      state: createGame(session.config),
      stateVersion: 0,
      joinedAt: timestamp,
      lastSeenAt: timestamp,
    }
    this.participants.set(participant.id, participant)
    this.participantIdsByTokenHash.set(participant.tokenHash, participant.id)

    return {
      token: secrets.token,
      recoveryCode: secrets.recoveryCode,
      game: this.toSessionSummary(session),
      participant: this.toParticipantSummary(participant),
      state: clone(participant.state!),
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
        && candidate.recoveryHash === hashSecret(input.recoveryCode),
    )
    if (!participant) {
      throw new ApiError(401, 'INVALID_RECOVERY', 'The recovery details are invalid.')
    }

    this.participantIdsByTokenHash.delete(participant.tokenHash)
    const secrets = issueSessionSecrets()
    participant.tokenHash = hashSecret(secrets.token)
    participant.recoveryHash = hashSecret(secrets.recoveryCode)
    participant.tokenExpiresAt = secrets.tokenExpiresAt
    participant.revokedAt = null
    participant.lastSeenAt = now()
    this.participantIdsByTokenHash.set(participant.tokenHash, participant.id)

    return {
      token: secrets.token,
      recoveryCode: secrets.recoveryCode,
      game: this.toSessionSummary(session),
      participant: this.toParticipantSummary(participant),
      state: participant.state ? clone(participant.state) : undefined,
      stateVersion: participant.stateVersion,
    }
  }

  async getSession(token: string) {
    const { participant, session } = this.authenticate(token)
    participant.lastSeenAt = now()
    return {
      game: this.toSessionSummary(session),
      participant: this.toParticipantSummary(participant),
      roster: this.getParticipantsForGame(session.id).map((member) =>
        this.toParticipantSummary(member),
      ),
      state: participant.state ? clone(participant.state) : null,
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
      session.startedAt = now()
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
    const { participant, session } = this.authenticate(token)
    if (participant.role !== 'player' || !participant.state) {
      throw new ApiError(403, 'PLAYER_REQUIRED', 'Only a player can change a factory state.')
    }
    if (session.status !== 'active') {
      throw new ApiError(409, 'GAME_NOT_ACTIVE', 'The facilitator must start this game first.')
    }

    await this.cleanupExpiredData()

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
      return { ...clone(existingReceipt.response), repeated: true }
    }

    if (input.expectedVersion !== participant.stateVersion) {
      throw new ApiError(
        409,
        'STALE_STATE',
        `Expected player state version ${participant.stateVersion}.`,
      )
    }

    const application = applyPlayerCommand(participant.state, input.command)
    if (application.error) {
      throw new ApiError(422, application.errorCode!, application.error)
    }
    participant.state = application.state
    participant.stateVersion += 1
    participant.lastSeenAt = now()
    const response: PlayerCommandResult = {
      state: clone(application.state),
      stateVersion: participant.stateVersion,
      repeated: false,
    }
    this.receipts.set(receiptKey, {
      fingerprint,
      response: clone(response),
      createdAt: Date.now(),
    })
    return response
  }

  async getReport(token: string, gameId: string) {
    const { session } = this.authenticateForGame(token, gameId)
    return this.buildReport(session)
  }

  async cleanupExpiredData() {
    const receiptCutoff = Date.now() - 24 * 60 * 60 * 1_000
    for (const [key, receipt] of this.receipts) {
      if (receipt.createdAt < receiptCutoff) this.receipts.delete(key)
    }
  }

  private authenticate(token: string) {
    const participantId = this.participantIdsByTokenHash.get(hashSecret(token))
    const participant = participantId ? this.participants.get(participantId) : undefined
    if (!participant) {
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

  private validateReportRounds(
    session: SessionRecord,
    input: EndSessionInput,
  ) {
    const maximumRound = Math.max(
      1,
      ...this.getParticipantsForGame(session.id)
        .filter((participant) => participant.role === 'player' && participant.state)
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

  private toSessionSummary(session: SessionRecord) {
    return {
      id: session.id,
      code: session.code,
      status: session.status,
      config: clone(session.config),
      createdAt: session.createdAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      penaltyRound: session.penaltyRound,
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
    }
  }

  private buildReport(session: SessionRecord) {
    const players = this.getParticipantsForGame(session.id)
      .filter((participant) => participant.role === 'player' && participant.state)
      .map((participant) => {
        const metrics = calculatePlayerReport(participant.state!, {
          penaltyRound: session.penaltyRound,
          endRound: session.endRound,
        })
        return {
          id: participant.id,
          name: participant.name,
          ...metrics,
          stateVersion: participant.stateVersion,
          lastSeenAt: participant.lastSeenAt,
        }
      })
      .sort((left, right) => right.projectedScore - left.projectedScore)
    return { game: this.toSessionSummary(session), players }
  }
}