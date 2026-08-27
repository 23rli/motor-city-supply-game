import { describe, expect, it } from 'vitest'
import { createGame, EVAN_RESOURCE_SCHEDULE } from './engine'
import { EVAN_OPTIMAL_BENCHMARK, getEvanOptimalBenchmark } from './evan-benchmark'

describe('exact v1 25-round benchmark', () => {
  const game = createGame({ resourcePlan: 'evan' })

  it('pins the recommended plan to the exact Evan resource schedule', () => {
    expect(game.config.resourceSchedule).toEqual(EVAN_RESOURCE_SCHEDULE)
    expect(game.config.resourceSchedule).toHaveLength(25)
  })

  it('publishes the engine-replayed optimal result', () => {
    expect(getEvanOptimalBenchmark(game.config, 25, 25)).toBe(EVAN_OPTIMAL_BENCHMARK)
    expect(EVAN_OPTIMAL_BENCHMARK).toEqual({
      score: 81,
      revenue: 81,
      wipPenalty: 0,
      throughput: 28,
      completed: { blue: 24, green: 2, red: 2, yellow: 0 },
    })
  })

  it('withholds the benchmark from any customized run', () => {
    expect(getEvanOptimalBenchmark(game.config, 24, 24)).toBeNull()
    expect(getEvanOptimalBenchmark({
      ...game.config,
      revenue: { ...game.config.revenue, blue: 4 },
    }, 25, 25)).toBeNull()
    expect(getEvanOptimalBenchmark({
      ...game.config,
      resourceSchedule: game.config.resourceSchedule.map((pool, index) => (
        index === 0 ? { ...pool, red: pool.red + 1 } : pool
      )),
    }, 25, 25)).toBeNull()
  })
})