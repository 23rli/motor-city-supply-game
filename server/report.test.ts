import { describe, expect, it } from 'vitest'
import {
  advanceRound,
  allocateResources,
  createGame,
  moveCar,
} from '../src/game/engine'
import { calculatePlayerReport } from './report'

describe('facilitator report settings', () => {
  it('measures WIP at the selected round instead of the current board', () => {
    let state = createGame({ enabledModels: ['green'] })
    state = moveCar(state, state.cars[0].id, 'manufacturing', 0).state
    state = allocateResources(state)
    state = advanceRound(state)

    const nextCar = state.cars.find((car) => car.stage === 'planning')!
    state = moveCar(state, nextCar.id, 'manufacturing', 1).state

    const report = calculatePlayerReport(state, {
      penaltyRound: 1,
      endRound: 2,
    })

    expect(report.wip.green).toBe(1)
    expect(report.projectedPenalty).toBe(1)
    expect(report.penaltyMeasuredAtRound).toBe(1)
    expect(report.scoredThroughRound).toBe(2)
  })
})