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

  it('retains only the newest terminal jobs', async () => {
    const service = new OptimizationJobs({ maxRetainedTerminalJobs: 2 })
    services.push(service)
    const input = {
      config: createGame({
        enabledModels: ['green'],
        resourceSchedule: abundant(1),
      }).config,
      endRound: 1,
      penaltyRound: 1,
    }

    const completed = []
    for (const gameId of ['game-1', 'game-2', 'game-3']) {
      const job = service.start(gameId, input)
      completed.push({ gameId, jobId: job.id })
      await vi.waitFor(() => {
        expect(service.get(gameId, job.id).status).toBe('optimal')
      }, { timeout: 15_000, interval: 50 })
    }

    expect(() => service.get(completed[0].gameId, completed[0].jobId)).toThrow(
      'OPTIMIZATION_JOB_NOT_FOUND',
    )
    expect(service.get(completed[1].gameId, completed[1].jobId).status).toBe('optimal')
    expect(service.get(completed[2].gameId, completed[2].jobId).status).toBe('optimal')
  }, 30_000)

  it('reports worker diagnostics without exposing them in the public job', async () => {
    const failures: Array<{ error: Error; jobId: string; gameId: string }> = []
    const service = new OptimizationJobs({
      onWorkerError: (error, context) => failures.push({ error, ...context }),
    })
    services.push(service)
    const config = createGame({
      enabledModels: ['green'],
      resourceSchedule: abundant(1),
    }).config
    config.enabledModels = []

    const started = service.start('broken-game', {
      config,
      endRound: 1,
      penaltyRound: 1,
    })
    await vi.waitFor(() => {
      expect(service.get('broken-game', started.id).status).toBe('failed')
    }, { timeout: 5_000, interval: 25 })

    expect(service.get('broken-game', started.id).message).toBe(
      'The optimizer could not construct a legal run for this setup.',
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({
      jobId: started.id,
      gameId: 'broken-game',
      error: { message: 'At least one model is required for optimization.' },
    })
  }, 10_000)
})
