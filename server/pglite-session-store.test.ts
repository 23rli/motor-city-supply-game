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

    const observerResponse = await firstApp.inject({
      method: 'POST',
      url: '/api/games/join',
      payload: { code: created.game.code, playerName: 'Observer' },
    })
    expect(observerResponse.statusCode).toBe(201)
    const observer = withCookie(observerResponse)

    const removedResponse = await firstApp.inject({
      method: 'POST',
      url: '/api/games/join',
      payload: { code: created.game.code, playerName: 'Casey' },
    })
    expect(removedResponse.statusCode).toBe(201)
    const removedPlayer = withCookie(removedResponse)

    const removal = await firstApp.inject({
      method: 'DELETE',
      url: `/api/games/${created.game.id}/participants/${removedPlayer.participant.id}`,
      headers: auth(created.cookie),
    })
    expect(removal.statusCode).toBe(200)

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
    const reportedPlayer = concurrentReport.json().players.find(
      (player: { id: string }) => player.id === joined.participant.id,
    )
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

    const removedRejoin = await secondApp.inject({
      method: 'POST',
      url: '/api/games/rejoin',
      payload: {
        code: created.game.code,
        playerName: 'Casey',
        recoveryCode: removedPlayer.recoveryCode,
      },
    })
    expect(removedRejoin.statusCode).toBe(401)
    expect(removedRejoin.json().error.code).toBe('INVALID_RECOVERY')

    const restoredFacilitator = await secondApp.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(created.cookie),
    })
    expect(restoredFacilitator.statusCode).toBe(200)
    expect(restoredFacilitator.json().roster).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Casey' })]),
    )

    await secondDatabase.query(
      `UPDATE idempotency_receipts
       SET response = jsonb_set(
         response,
         '{state,config,wipPenalty}',
         $2::jsonb
       )
       WHERE participant_id = $1`,
      [
        joined.participant.id,
        JSON.stringify({ blue: 99, green: 98, red: 97, yellow: 96 }),
      ],
    )

    const retry = await secondApp.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(joined.cookie),
      payload: movePayload,
    })
    expect(retry.statusCode).toBe(200)
    expect(retry.json()).toMatchObject({ stateVersion: 1, repeated: true })
    expect(retry.json().state.config.wipPenalty).toEqual({
      blue: 0,
      green: 0,
      red: 0,
      yellow: 0,
    })

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

    const [firstEnd, secondEnd, concurrentPoll] = await Promise.all([
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
      secondApp.inject({
        method: 'GET',
        url: '/api/session',
        headers: auth(observer.cookie),
      }),
    ])
    expect([firstEnd.statusCode, secondEnd.statusCode, concurrentPoll.statusCode])
      .toEqual([200, 200, 200])
    expect(firstEnd.json().game.endedAt).toBe(secondEnd.json().game.endedAt)

    const observerTimestamp = await secondDatabase.query<{
      last_seen_at: Date | string
    }>(
      'SELECT last_seen_at FROM participants WHERE id = $1',
      [observer.participant.id],
    )
    const persistedObserverTime = new Date(
      observerTimestamp.rows[0].last_seen_at,
    ).toISOString()
    for (const endResponse of [firstEnd, secondEnd]) {
      const reportedObserver = endResponse.json().report.players.find(
        (player: { id: string }) => player.id === observer.participant.id,
      )
      expect(reportedObserver.lastSeenAt).toBe(persistedObserverTime)
    }

    const observerAfterFinish = await secondApp.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(observer.cookie),
    })
    expect(observerAfterFinish.statusCode).toBe(200)
    expect(observerAfterFinish.json().participant.lastSeenAt).toBe(
      persistedObserverTime,
    )

    const recoveryAfterFinish = await secondApp.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/participants/${joined.participant.id}/recovery`,
      headers: auth(created.cookie),
    })
    expect(recoveryAfterFinish.statusCode).toBe(409)
    expect(recoveryAfterFinish.json().error.code).toBe('GAME_FINISHED')

    const removalAfterFinish = await secondApp.inject({
      method: 'DELETE',
      url: `/api/games/${created.game.id}/participants/${joined.participant.id}`,
      headers: auth(created.cookie),
    })
    expect(removalAfterFinish.statusCode).toBe(409)
    expect(removalAfterFinish.json().error.code).toBe('GAME_FINISHED')

    const beforeFinishedRestore = await secondDatabase.query<{
      last_seen_at: Date | string
    }>(
      'SELECT last_seen_at FROM participants WHERE id = $1',
      [joined.participant.id],
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
    const finishedCredentials = withCookie(finishedRejoin)
    const finishedRestore = await secondApp.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(finishedCredentials.cookie),
    })
    expect(finishedRestore.statusCode).toBe(200)
    const afterFinishedRestore = await secondDatabase.query<{
      last_seen_at: Date | string
    }>(
      'SELECT last_seen_at FROM participants WHERE id = $1',
      [joined.participant.id],
    )
    expect(new Date(afterFinishedRestore.rows[0].last_seen_at).toISOString()).toBe(
      new Date(beforeFinishedRestore.rows[0].last_seen_at).toISOString(),
    )
    // Starting PGlite twice takes about 19s, so leave headroom for a loaded machine.
  }, 60_000)
})