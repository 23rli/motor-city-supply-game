import { DEFAULT_REVENUE, DEFAULT_WIP_PENALTY } from '../game/engine'
import { recommendedClassTimerConfig } from '../game/timer'
import { CAR_MODELS, type CarModel, type ResourcePlan, type RoundTimerConfig } from '../game/types'

interface RecommendedSetupState {
  models: CarModel[]
  resourcePlan: ResourcePlan
  revenue: Record<CarModel, number>
  wipPenalty: Record<CarModel, number>
  endRound: number
  penaltyRound: number
  timer: RoundTimerConfig
}

export function isRecommendedClassSetup({
  models,
  resourcePlan,
  revenue,
  wipPenalty,
  endRound,
  penaltyRound,
  timer,
}: RecommendedSetupState) {
  return resourcePlan === 'classic'
    && endRound === 10
    && penaltyRound === 10
    && models.length === CAR_MODELS.length
    && CAR_MODELS.every((model) => (
      models.includes(model)
      && revenue[model] === DEFAULT_REVENUE[model]
      && wipPenalty[model] === DEFAULT_WIP_PENALTY[model]
    ))
    && JSON.stringify(timer) === JSON.stringify(recommendedClassTimerConfig())
}