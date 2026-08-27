import {
  DEFAULT_REVENUE,
  DEFAULT_WIP_PENALTY,
  EVAN_RESOURCE_SCHEDULE,
} from './engine'
import { CAR_MODELS, RESOURCES, type GameConfig } from './types'

export const EVAN_OPTIMAL_BENCHMARK = {
  score: 82,
  revenue: 82,
  wipPenalty: 0,
  throughput: 28,
  completed: { blue: 24, green: 0, red: 4, yellow: 0 },
} as const

export type EvanOptimalBenchmark = typeof EVAN_OPTIMAL_BENCHMARK

const exactPool = (
  left: GameConfig['resourceSchedule'][number],
  right: GameConfig['resourceSchedule'][number],
) => RESOURCES.every((resource) => left[resource] === right[resource])

export function getEvanOptimalBenchmark(
  config: GameConfig,
  endRound: number | null,
  penaltyRound: number | null,
): EvanOptimalBenchmark | null {
  const exactModels = config.enabledModels.length === CAR_MODELS.length
    && CAR_MODELS.every((model) => config.enabledModels.includes(model))
  const standardEconomics = CAR_MODELS.every((model) => (
    config.revenue[model] === DEFAULT_REVENUE[model]
    && config.wipPenalty[model] === DEFAULT_WIP_PENALTY[model]
  ))
  const exactSchedule = config.resourceSchedule.length === EVAN_RESOURCE_SCHEDULE.length
    && EVAN_RESOURCE_SCHEDULE.every((pool, index) => (
      exactPool(config.resourceSchedule[index], pool)
    ))

  return config.resourcePlan === 'evan'
    && exactModels
    && standardEconomics
    && exactSchedule
    && endRound === 25
    && penaltyRound === 25
    ? EVAN_OPTIMAL_BENCHMARK
    : null
}