export const RESOURCES = ['red', 'yellow', 'blue'] as const
export type Resource = (typeof RESOURCES)[number]

export const CAR_MODELS = ['blue', 'green', 'red', 'yellow'] as const
export type CarModel = (typeof CAR_MODELS)[number]

export const STAGES = [
  'planning',
  'manufacturing',
  'assembly',
  'quality',
  'paint',
  'done',
] as const
export type Stage = (typeof STAGES)[number]

export type ResourcePool = Record<Resource, number>
export type ModelValues = Record<CarModel, number>

export interface Car {
  id: string
  model: CarModel
  stage: Stage
  row: number
  resources: ResourcePool
  ready: boolean
  completedRound: number | null
}

export interface GameConfig {
  enabledModels: CarModel[]
  resourceSchedule: ResourcePool[]
  revenue: ModelValues
  wipPenalty: ModelValues
}

export interface RoundSummary {
  round: number
  completed: ModelValues
  revenue: number
  wip: ModelValues
  projectedPenalty: number
  unusedResources: ResourcePool
}

export interface GameSnapshot {
  round: number
  cars: Car[]
  resources: ResourcePool
  convertedResources: ResourcePool
  paintBatchStartedRound: number | null
  nextCarNumber: number
}

export interface GameState extends GameSnapshot {
  config: GameConfig
  checkpoint: GameSnapshot
  history: RoundSummary[]
}

export interface ActionResult {
  state: GameState
  error: string | null
}