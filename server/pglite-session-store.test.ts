import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app'
import { PGliteSessionStore } from './pglite-session-store'

const apps: FastifyInstance[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    ),
  )
})

const auth = (cookie: string) => ({ cookie })

const withCookie = (response: Awaited<ReturnType<FastifyInstance['inject']>>) => {
  const setCookie = response.headers['set-cookie']
  const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie
  if (!rawCookie) throw new Error('Expected a session cookie.')
  return { ...response.json(), cookie: rawCookie.split(';')[0] }
}

describe('PostgreSQL session persistence', () => {
  it('restores player state and idempotency receipts after a database restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'motor-city-pglite-'))
    directories.push(directory)

    const firstStore = await PGliteSessionStore.create(new PGlite(directory))
    const firstApp = buildApp(firstStore)
    apps.push(firstApp)

    const createdResponse = await firstApp.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        facilitatorName: 'Jordan',
        enabledModels: ['blue', 'green'],
        resourcePlan: 'classic',
      },
    })
    expect(createdResponse.statusCode).toBe(201)
    const created = withCookie(createdResponse)

    const joinedResponse = await firstApp.inject({
      method: 'POST',
      url: '/api/games/join',
      payload: { code: created.game.code, playerName: 'Riley' },
    })
    expect(joinedResponse.statusCode).toBe(201)
    const joined = withCookie(joinedResponse)

    await firstApp.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(created.cookie),
    })

    const idempotencyKey = randomUUID()
    const movePayload = {
      expectedVersion: 0,
      idempotencyKey,
      command: {
        type: 'move',
        carId: joined.state.cars[0].id,
        toStage: 'manufacturing',
        toRow: 0,
      },
    }
    const move = await firstApp.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(joined.cookie),
      payload: movePayload,
    })
    expect(move.statusCode).toBe(200)
    expect(move.json().stateVersion).toBe(1)

    const concurrentCommands = await Promise.all([
      firstApp.inject({
        method: 'POST',
        url: '/api/player/commands',
        headers: auth(joined.cookie),
        payload: {
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
          command: { type: 'allocate' },
        },
      }),
      firstApp.inject({
        method: 'POST',
        url: '/api/player/commands',
        headers: auth(joined.cookie),
        payload: {
          expectedVersion: 1,
          idempotencyKey: randomUUID(),
          command: { type: 'advance' },
        },
      }),
    ])
    expect(concurrentCommands.map((response) => response.statusCode).sort()).toEqual([
      200,
      409,
    ])

    const winningCommand = concurrentCommands.find(
      (response) => response.statusCode === 200,
    )!
    const nextPlanningCar = winningCommand.json().state.cars.find(
      (car: { stage: string }) => car.stage === 'planning',
    )
    const [moveAgain, concurrentReport] = await Promise.all([
      firstApp.inject({
        method: 'POST',
        url: '/api/player/commands',
        headers: auth(joined.cookie),
        payload: {
          expectedVersion: 2,
          idempotencyKey: randomUUID(),
          command: {
            type: 'move',
            carId: nextPlanningCar.id,
            toStage: 'manufacturing',
            toRow: 1,
          },
        },
      }),
      firstApp.inject({
        method: 'GET',
        url: `/api/games/${created.game.id}/report`,
        headers: auth(created.cookie),
      }),
    ])
    expect(moveAgain.statusCode).toBe(200)
    expect(concurrentReport.statusCode).toBe(200)
    const reportedPlayer = concurrentReport.json().players[0]
    const reportedWip = Object.values(reportedPlayer.wip as Record<string, number>)
      .reduce((sum, value) => sum + value, 0)
    expect([2, 3]).toContain(reportedPlayer.stateVersion)
    expect(reportedWip).toBe(reportedPlayer.stateVersion - 1)

    await firstApp.close()
    apps.splice(apps.indexOf(firstApp), 1)

    const secondDatabase = new PGlite(directory)
    const secondStore = await PGliteSessionStore.create(secondDatabase)
    const secondApp = buildApp(secondStore)
    apps.push(secondApp)

    const restored = await secondApp.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(joined.cookie),
    })
    expect(restored.statusCode).toBe(200)
    expect(restored.json()).toMatchObject({
      game: { status: 'active' },
      participant: { name: 'Riley' },
      stateVersion: 3,
    })
    expect(restored.json().state.cars).toHaveLength(4)

    const retry = await secondApp.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(joined.cookie),
      payload: movePayload,
    })
    expect(retry.statusCode).toBe(200)
    expect(retry.json()).toMatchObject({ stateVersion: 1, repeated: true })

    await secondDatabase.query(
      `UPDATE idempotency_receipts
       SET created_at = NOW() - INTERVAL '25 hours'
       WHERE participant_id = $1`,
      [joined.participant.id],
    )
    await secondStore.cleanupExpiredData()
    const expiredRetry = await secondApp.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(joined.cookie),
      payload: movePayload,
    })
    expect(expiredRetry.statusCode).toBe(409)
    expect(expiredRetry.json().error.code).toBe('STALE_STATE')

    const rejoinResponse = await secondApp.inject({
      method: 'POST',
      url: '/api/games/rejoin',
      payload: {
        code: created.game.code,
        playerName: 'Riley',
        recoveryCode: joined.recoveryCode,
      },
    })
    expect(rejoinResponse.statusCode).toBe(200)
    const rejoined = withCookie(rejoinResponse)
    expect(rejoined.recoveryCode).not.toBe(joined.recoveryCode)

    const oldSession = await secondApp.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(joined.cookie),
    })
    expect(oldSession.statusCode).toBe(401)

    const revoke = await secondApp.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: auth(rejoined.cookie),
    })
    expect(revoke.statusCode).toBe(204)

    const revoked = await secondApp.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(rejoined.cookie),
    })
    expect(revoked.statusCode).toBe(401)

    const invalidEnd = await secondApp.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/end`,
      headers: auth(created.cookie),
      payload: { penaltyRound: 4, endRound: 4 },
    })
    expect(invalidEnd.statusCode).toBe(422)
    expect(invalidEnd.json().error.code).toBe('INVALID_REPORT_ROUND')

    const concurrentEnds = await Promise.all([
      secondApp.inject({
        method: 'POST',
        url: `/api/games/${created.game.id}/end`,
        headers: auth(created.cookie),
        payload: { penaltyRound: 1, endRound: 1 },
      }),
      secondApp.inject({
        method: 'POST',
        url: `/api/games/${created.game.id}/end`,
        headers: auth(created.cookie),
        payload: { penaltyRound: 1, endRound: 1 },
      }),
    ])
    expect(concurrentEnds.map((response) => response.statusCode)).toEqual([200, 200])
    expect(concurrentEnds[0].json().game.endedAt).toBe(
      concurrentEnds[1].json().game.endedAt,
    )

    const finishedRejoin = await secondApp.inject({
      method: 'POST',
      url: '/api/games/rejoin',
      payload: {
        code: created.game.code,
        playerName: 'Riley',
        recoveryCode: rejoined.recoveryCode,
      },
    })
    expect(finishedRejoin.statusCode).toBe(200)
    expect(finishedRejoin.json().game.status).toBe('finished')
  }, 20_000)
})