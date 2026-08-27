import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGame } from '../src/game/engine'
import type { ResourcePool } from '../src/game/types'
import { OptimizationJobs } from './optimizer-jobs'

const services: OptimizationJobs[] = []

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()))
})

const abundant = (rounds: number): ResourcePool[] => Array.from(
  { length: rounds },
  () => ({ red: 10, yellow: 8, blue: 4 }),
)

describe('optimization worker queue', () => {
  it('deduplicates a setup and returns its engine-replayed result', async () => {
    const service = new OptimizationJobs()
    services.push(service)
    const input = {
      config: createGame({
        enabledModels: ['green'],
        resourceSchedule: abundant(6),
      }).config,
      endRound: 6,
      penaltyRound: 6,
    }

    const started = service.start('game-1', input)
    const duplicate = service.start('game-1', structuredClone(input))

    expect(['queued', 'running']).toContain(started.status)
    expect(duplicate.id).toBe(started.id)

    await vi.waitFor(() => {
      expect(service.get('game-1', started.id).status).toBe('optimal')
    }, { timeout: 15_000, interval: 50 })

    expect(service.get('game-1', started.id)).toMatchObject({
      status: 'optimal',
      player: {
        name: 'Optimal Run',
        projectedScore: 6,
        throughput: 3,
      },
    })
    expect(() => service.get('another-game', started.id)).toThrow(
      'OPTIMIZATION_JOB_NOT_FOUND',
    )
  }, 20_000)
})
