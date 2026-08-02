import type { CarModel } from '../game/types'
import type {
  PlayerCommand,
  PlayerCommandResponse,
  TeamCredentials,
  TeamReport,
  TeamSessionSnapshot,
} from './types'

interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
  }
}

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** A stalled connection must fail loudly rather than leave the UI waiting forever. */
const REQUEST_TIMEOUT_MS = 15_000

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('accept', 'application/json')
  if (options.body) headers.set('content-type', 'application/json')

  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: 'same-origin',
      signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new ApiClientError(
      'The game service is unavailable. Check your connection and try again.',
      0,
      'NETWORK_ERROR',
    )
  }

  if (response.status === 204) return undefined as T
  const body = await response.json() as T & ApiErrorBody
  if (!response.ok) {
    throw new ApiClientError(
      body.error?.message ?? 'The request could not be completed.',
      response.status,
      body.error?.code ?? 'REQUEST_FAILED',
    )
  }
  return body
}

export const teamApi = {
  createGame(input: {
    facilitatorName: string
    enabledModels: CarModel[]
    resourcePlan: 'classic' | 'random'
  }) {
    return request<TeamCredentials>('/api/games', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  joinGame(input: { code: string; playerName: string }) {
    return request<TeamCredentials>('/api/games/join', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  rejoinGame(input: {
    code: string
    playerName: string
    recoveryCode: string
  }) {
    return request<TeamCredentials>('/api/games/rejoin', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },

  getSession() {
    return request<TeamSessionSnapshot>('/api/session')
  },

  revokeSession() {
    return request<void>('/api/session', { method: 'DELETE' })
  },

  startGame(gameId: string) {
    return request<{ game: TeamSessionSnapshot['game'] }>(
      `/api/games/${gameId}/start`,
      { method: 'POST' },
    )
  },

  endGame(
    gameId: string,
    input: { penaltyRound: number; endRound: number },
  ) {
    return request<{ game: TeamSessionSnapshot['game']; report: TeamReport }>(
      `/api/games/${gameId}/end`,
      { method: 'POST', body: JSON.stringify(input) },
    )
  },

  getReport(gameId: string) {
    return request<TeamReport>(`/api/games/${gameId}/report`)
  },

  readmitParticipant(gameId: string, participantId: string) {
    return request<{ participantId: string; name: string; recoveryCode: string }>(
      `/api/games/${gameId}/participants/${participantId}/recovery`,
      { method: 'POST' },
    )
  },

  removeParticipant(gameId: string, participantId: string) {
    return request<{ participantId: string; name: string }>(
      `/api/games/${gameId}/participants/${participantId}`,
      { method: 'DELETE' },
    )
  },

  sendCommand(
    stateVersion: number,
    command: PlayerCommand,
  ) {
    return request<PlayerCommandResponse>(
      '/api/player/commands',
      {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: stateVersion,
          idempotencyKey: crypto.randomUUID(),
          command,
        }),
      },
    )
  },
}