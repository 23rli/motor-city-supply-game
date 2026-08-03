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

  it('reports peak and average WIP across the run, not just the final board', () => {
    let state = createGame({ enabledModels: ['green'] })

    // One car reaches the floor each round, so WIP climbs as they accumulate.
    for (let round = 0; round < 3; round += 1) {
      const waiting = state.cars.find((car) => car.stage === 'planning')
      if (waiting) {
        state = moveCar(state, waiting.id, 'manufacturing', round).state
      }
      state = allocateResources(state)
      state = advanceRound(state)
    }

    const report = calculatePlayerReport(state, { penaltyRound: null, endRound: null })

    expect(report.peakWip).toBeGreaterThanOrEqual(2)
    expect(report.averageWip).toBeGreaterThan(0)
    expect(report.averageWip).toBeLessThanOrEqual(report.peakWip)
  })

  it('ignores rounds played after the scored end round', () => {
    let state = createGame({ enabledModels: ['green'] })
    state = allocateResources(state)
    state = advanceRound(state)

    const early = calculatePlayerReport(state, { penaltyRound: null, endRound: 1 })

    // Pile work on after the cutoff; the scored peak must not move.
    for (const car of state.cars.filter((item) => item.stage === 'planning').slice(0, 3)) {
      state = moveCar(state, car.id, 'manufacturing', car.row).state
    }
    state = allocateResources(state)
    state = advanceRound(state)

    const late = calculatePlayerReport(state, { penaltyRound: null, endRound: 1 })

    expect(late.peakWip).toBe(early.peakWip)
    expect(late.scoredThroughRound).toBe(1)
  })

  it('never reports NaN on a board that has not advanced yet', () => {
    const state = createGame({ enabledModels: ['green'] })
    const report = calculatePlayerReport(state, { penaltyRound: null, endRound: null })

    expect(Number.isFinite(report.peakWip)).toBe(true)
    expect(Number.isFinite(report.averageWip)).toBe(true)
    expect(report.throughput).toBe(0)
  })
})