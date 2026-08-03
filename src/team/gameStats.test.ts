import { describe, expect, it } from 'vitest'
import { GAME_STAT_ROWS, summarizeGameStats } from './gameStats'
import type { TeamPlayerReport } from './types'

const player = (overrides: Partial<TeamPlayerReport>): TeamPlayerReport => ({
  id: 'id',
  name: 'Player',
  identifier: null,
  round: 5,
  stateVersion: 1,
  completed: { blue: 0, green: 0, red: 0, yellow: 0 },
  wip: { blue: 0, green: 0, red: 0, yellow: 0 },
  revenue: 0,
  projectedPenalty: 0,
  projectedScore: 0,
  lastSeenAt: new Date().toISOString(),
  scoredThroughRound: 5,
  penaltyMeasuredAtRound: 5,
  peakWip: 0,
  averageWip: 0,
  throughput: 0,
  currentRound: 5,
  stranded: { red: 0, yellow: 0, blue: 0 },
  paint: { occupancy: 0, curing: false, cured: 0 },
  ...overrides,
})

describe('cohort game statistics', () => {
  it('reports low, high, median and mean for an odd number of players', () => {
    const stats = summarizeGameStats([
      player({ revenue: 100 }),
      player({ revenue: 300 }),
      player({ revenue: 200 }),
    ])

    expect(stats.revenueBeforePenalty).toEqual({
      low: 100,
      high: 300,
      median: 200,
      mean: 200,
    })
  })

  it('averages the middle pair for an even number of players', () => {
    const stats = summarizeGameStats([
      player({ peakWip: 4 }),
      player({ peakWip: 10 }),
      player({ peakWip: 6 }),
      player({ peakWip: 8 }),
    ])

    expect(stats.peakWip).toEqual({ low: 4, high: 10, median: 7, mean: 7 })
  })

  it('separates revenue before and after the penalty', () => {
    const stats = summarizeGameStats([
      player({ revenue: 500, projectedPenalty: 120, projectedScore: 380 }),
    ])

    expect(stats.revenueBeforePenalty.mean).toBe(500)
    expect(stats.wipPenalty.mean).toBe(120)
    expect(stats.revenueAfterPenalty.mean).toBe(380)
  })

  it('returns zeroes rather than NaN for an empty cohort', () => {
    const stats = summarizeGameStats([])

    for (const row of GAME_STAT_ROWS) {
      expect(stats[row.key]).toEqual({ low: 0, high: 0, median: 0, mean: 0 })
    }
  })

  it('covers every reported measure with a row definition', () => {
    const stats = summarizeGameStats([player({})])

    expect(GAME_STAT_ROWS.map((row) => row.key).sort()).toEqual(
      Object.keys(stats).sort(),
    )
  })
})
