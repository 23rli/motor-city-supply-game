import type {
  GameConfig,
  GameState,
  ModelValues,
  Resource,
  ResourcePool,
  Stage,
} from '../game/types'

export type TeamStatus = 'waiting' | 'active' | 'finished'
export type TeamRole = 'facilitator' | 'player'

export type PlayerCommand =
  | { type: 'move'; carId: string; toStage: Stage; toRow: number }
  | { type: 'allocate' }
  | { type: 'convert'; spend: ResourcePool; receive: Resource }
  | { type: 'advance' }
  | { type: 'reset' }

export interface TeamGameSummary {
  id: string
  code: string
  status: TeamStatus
  config: GameConfig
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  penaltyRound: number | null
  endRound: number | null
}

export interface TeamParticipant {
  id: string
  name: string
  role: TeamRole
  stateVersion: number
  joinedAt: string
  lastSeenAt: string
}

export interface TeamSessionSnapshot {
  game: TeamGameSummary
  participant: TeamParticipant
  roster: TeamParticipant[]
  state: GameState | null
  stateVersion: number
}

export interface TeamCredentials {
  recoveryCode: string
  game: TeamGameSummary
  participant: TeamParticipant
  state?: GameState
  stateVersion?: number
}

export interface TeamPlayerReport {
  id: string
  name: string
  round: number
  stateVersion: number
  completed: ModelValues
  wip: ModelValues
  revenue: number
  projectedPenalty: number
  projectedScore: number
  lastSeenAt: string
  scoredThroughRound: number
  penaltyMeasuredAtRound: number
}

export interface TeamReport {
  game: TeamGameSummary
  players: TeamPlayerReport[]
}

export interface PlayerCommandResponse {
  state: GameState
  stateVersion: number
  repeated: boolean
}