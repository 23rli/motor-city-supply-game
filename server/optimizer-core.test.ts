import { describe, expect, it } from 'vitest'
import { createGame } from '../src/game/engine'
import type { ResourcePool } from '../src/game/types'
import { optimizeGame } from './optimizer-core'

const abundant = (rounds: number): ResourcePool[] => Array.from(
  { length: rounds },
  () => ({ red: 10, yellow: 8, blue: 4 }),
)

describe('dynamic run optimizer', () => {
  it('solves and engine-replays a custom single-model game', async () => {
    const config = createGame({
      enabledModels: ['green'],
      resourceSchedule: abundant(6),
    }).config

    const solution = await optimizeGame(
      { config, endRound: 6, penaltyRound: 6 },
      { timeLimitSeconds: 5 },
    )

    expect(solution.proof).toBe('optimal')
    expect(solution.player).toMatchObject({
      name: 'Optimal Run',
      projectedScore: 6,
      revenue: 6,
      projectedPenalty: 0,
      throughput: 3,
      completed: { blue: 0, green: 3, red: 0, yellow: 0 },
      wip: { blue: 0, green: 0, red: 0, yellow: 0 },
    })
    expect(solution.player.history).toHaveLength(6)
  })

  it('uses custom economics in the objective', async () => {
    const config = createGame({
      enabledModels: ['blue'],
      resourceSchedule: abundant(6),
      revenue: { blue: 10, green: 2, red: 2.5, yellow: 2.5 },
      wipPenalty: { blue: 4, green: 1, red: 1.25, yellow: 1.25 },
    }).config

    const solution = await optimizeGame(
      { config, endRound: 6, penaltyRound: 6 },
      { timeLimitSeconds: 5 },
    )

    expect(solution.proof).toBe('optimal')
    expect(solution.player.projectedScore).toBe(30)
    expect(solution.player.completed.blue).toBe(3)
  })

  it('respects a WIP measurement round before the final round', async () => {
    const config = createGame({
      enabledModels: ['blue'],
      resourceSchedule: abundant(6),
    }).config

    const solution = await optimizeGame(
      { config, endRound: 6, penaltyRound: 1 },
      { timeLimitSeconds: 5 },
    )

    expect(solution.proof).toBe('optimal')
    expect(solution.player.revenue).toBe(9)
    expect(solution.player.projectedPenalty).toBe(4.5)
    expect(solution.player.projectedScore).toBe(4.5)
  })

  it('includes cars dwelling in paint at the WIP measurement round', async () => {
    const config = createGame({
      enabledModels: ['green'],
      resourceSchedule: abundant(6),
    }).config

    const solution = await optimizeGame(
      { config, endRound: 6, penaltyRound: 4 },
      { timeLimitSeconds: 5 },
    )

    expect(solution.proof).toBe('optimal')
    expect(solution.player).toMatchObject({
      revenue: 6,
      projectedPenalty: 3,
      projectedScore: 3,
      completed: { blue: 0, green: 3, red: 0, yellow: 0 },
      wip: { blue: 0, green: 3, red: 0, yellow: 0 },
    })
  })

  it('returns a productive legal baseline when a larger solve hits its time limit', async () => {
    const config = createGame({
      enabledModels: ['blue', 'green', 'red', 'yellow'],
      resourceSchedule: abundant(30),
    }).config

    const solution = await optimizeGame(
      { config, endRound: 30, penaltyRound: 30 },
      { timeLimitSeconds: 0.01 },
    )

    expect(solution.player.history).toHaveLength(30)
    expect(solution.player.throughput).toBeGreaterThan(0)
    expect(solution.player.projectedScore).toBeGreaterThan(0)
  }, 15_000)

  it('never calls a negative production route the best available run', async () => {
    const config = createGame({
      enabledModels: ['blue'],
      resourceSchedule: abundant(6),
      revenue: { blue: 1, green: 2, red: 2.5, yellow: 2.5 },
      wipPenalty: { blue: 100, green: 1, red: 1.25, yellow: 1.25 },
    }).config

    const solution = await optimizeGame(
      { config, endRound: 6, penaltyRound: 1 },
      { timeLimitSeconds: 5 },
    )

    expect(solution.proof).toBe('optimal')
    expect(solution.player.projectedScore).toBe(0)
    expect(solution.player.throughput).toBe(0)
  })
})
