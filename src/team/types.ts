import type {
  GameConfig,
  GameState,
  ModelValues,
  Resource,
  ResourcePool,
  RoundSummary,
  Stage,
} from '../game/types'

export type TeamStatus = 'waiting' | 'active' | 'finished'
export type TeamRole = 'facilitator' | 'player'

export type PlayerCommand =
  | { type: 'move'; carId: string; toStage: Stage; toRow: number }
  | { type: 'reposition'; carId: string; toRow: number }
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
  identifier: string | null
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
  peakWip: number
  averageWip: number
  throughput: number
  currentRound: number
  stranded: ResourcePool
  paint: { occupancy: number; curing: boolean; cured: number }
}

export interface TeamReport {
  game: TeamGameSummary
  players: TeamPlayerReport[]
}

export interface TeamExportPlayer extends TeamPlayerReport {
  history: RoundSummary[]
}

export interface TeamExport {
  game: TeamGameSummary
  players: TeamExportPlayer[]
}

export interface PlayerCommandResponse {
  state: GameState
  stateVersion: number
  repeated: boolean
}