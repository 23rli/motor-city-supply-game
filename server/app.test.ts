import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { SESSION_TTL_MS } from './session-security'
import { InMemorySessionStore } from './session-store-core'

const apps: FastifyInstance[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

const makeApp = (options: {
  coarseRateLimitMax?: number
  staticRoot?: string
  trustProxy?: boolean | string
} = {}) => {
  const app = buildApp(new InMemorySessionStore(), options)
  apps.push(app)
  return app
}

class PausedCleanupStore extends InMemorySessionStore {
  private pause: { notify: () => void; wait: Promise<void> } | null = null

  pauseNextCleanup() {
    let notify!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { notify = resolve })
    const wait = new Promise<void>((resolve) => { release = resolve })
    this.pause = { notify, wait }
    return { started, release }
  }

  override async cleanupExpiredData() {
    const pause = this.pause
    this.pause = null
    if (pause) {
      pause.notify()
      await pause.wait
    }
    await super.cleanupExpiredData()
  }
}

const auth = (cookie: string) => ({ cookie })

const withCookie = (response: Awaited<ReturnType<FastifyInstance['inject']>>) => {
  const setCookie = response.headers['set-cookie']
  const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie
  if (!rawCookie) throw new Error('Expected a session cookie.')
  return {
    ...response.json(),
    headers: response.headers,
    cookie: rawCookie.split(';')[0],
    cookieHeader: rawCookie,
  }
}

const createSession = async (app: FastifyInstance) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/games',
    payload: {
      facilitatorName: 'Morgan',
      enabledModels: ['blue', 'green', 'red', 'yellow'],
      resourcePlan: 'classic',
    },
  })
  expect(response.statusCode).toBe(201)
  return withCookie(response)
}

const joinSession = async (
  app: FastifyInstance,
  code: string,
  playerName: string,
  identifier?: string,
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/games/join',
    payload: { code, playerName, identifier },
  })
  expect(response.statusCode).toBe(201)
  return withCookie(response)
}

describe('multiplayer API', () => {
  it('fails health checks when the persistence layer is unavailable', async () => {
    class UnhealthyStore extends InMemorySessionStore {
      override async healthCheck() {
        throw new Error('database unavailable')
      }
    }
    const app = buildApp(new UnhealthyStore())
    apps.push(app)

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(500)
    expect(response.json().error.code).toBe('INTERNAL_ERROR')
  })

  it('rate limits the public database health probe by IP', async () => {
    const app = makeApp()
    const responses = []

    for (let attempt = 0; attempt < 121; attempt += 1) {
      responses.push(await app.inject({
        method: 'GET',
        url: '/api/health',
        remoteAddress: '203.0.113.30',
      }))
    }

    expect(responses.slice(0, 120).every((response) => response.statusCode === 200)).toBe(true)
    expect(responses[120].statusCode).toBe(429)
  })

  it('admits a full classroom joining concurrently behind one shared IP', async () => {
    const app = makeApp()
    const created = await createSession(app)

    const joins = await Promise.all(
      Array.from({ length: 40 }, (_, index) => app.inject({
        method: 'POST',
        url: '/api/games/join',
        payload: {
          code: created.game.code,
          playerName: `Student ${String(index + 1).padStart(2, '0')}`,
        },
      })),
    )

    expect(joins.map((response) => response.statusCode)).toEqual(
      Array.from({ length: 40 }, () => 201),
    )
    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(created.cookie),
    })
    expect(
      snapshot.json().roster.filter(
        (participant: { role: string }) => participant.role === 'player',
      ),
    ).toHaveLength(40)
  })

  it('rate limits repeated session-entry guesses without blocking a class burst', async () => {
    const app = makeApp()
    const responses = []

    for (let attempt = 0; attempt < 121; attempt += 1) {
      responses.push(await app.inject({
        method: 'POST',
        url: '/api/games/join',
        remoteAddress: '198.51.100.10',
        payload: { code: 'AAAAAA', playerName: 'Probe' },
      }))
    }

    expect(responses.slice(0, 120).every((response) => response.statusCode === 404)).toBe(true)
    expect(responses[120].statusCode).toBe(429)
    expect(responses[120].headers['x-ratelimit-limit']).toBe('120')
    expect(responses[120].json().error.code).toBe('RATE_LIMITED')
  })

  it('applies a coarse IP ceiling even when bogus bearer credentials rotate', async () => {
    const app = makeApp({ coarseRateLimitMax: 3 })
    const responses = []

    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.push(await app.inject({
        method: 'GET',
        url: '/api/session',
        remoteAddress: '198.51.100.20',
        headers: { authorization: `Bearer bogus-${attempt}` },
      }))
    }

    expect(responses.slice(0, 3).every((response) => response.statusCode === 401)).toBe(true)
    expect(responses[3].statusCode).toBe(429)
    expect(responses[3].json().error.code).toBe('RATE_LIMITED')
  })

  it('ignores spoofed forwarding hops when only the loopback proxy is trusted', async () => {
    const app = makeApp({ trustProxy: '127.0.0.1' })
    const responses = []

    for (let attempt = 0; attempt < 121; attempt += 1) {
      responses.push(await app.inject({
        method: 'POST',
        url: '/api/games/join',
        remoteAddress: '127.0.0.1',
        headers: {
          'x-forwarded-for': `198.51.100.${attempt % 250}, 203.0.113.10`,
        },
        payload: { code: 'AAAAAA', playerName: 'Probe' },
      }))
    }

    expect(responses[120].statusCode).toBe(429)
  })

  it('rate limits session creation separately from classroom entry', async () => {
    const app = makeApp()

    const responses = []
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(await app.inject({
        method: 'POST',
        url: '/api/games',
        remoteAddress: '203.0.113.10',
        payload: {
          facilitatorName: `Facilitator ${attempt}`,
          enabledModels: ['blue'],
          resourcePlan: 'classic',
        },
      }))
    }

    expect(responses.slice(0, 10).every((response) => response.statusCode === 201)).toBe(true)
    expect(responses[10].statusCode).toBe(429)
    expect(responses[10].headers['x-ratelimit-limit']).toBe('10')
  })

  it('creates a waiting game and restores sessions from opaque tokens', async () => {
    const app = makeApp()
    const created = await createSession(app)

    expect(created.game.code).toMatch(/^[A-Z2-9]{6}$/)
    expect(created.game.status).toBe('waiting')
    expect(created.game).toMatchObject({
      penaltyRound: 10,
      endRound: 10,
      config: { timer: { enabled: false } },
    })
    expect(created.participant.role).toBe('facilitator')
    expect(created.token).toBeUndefined()
    expect(created.recoveryCode).toHaveLength(24)
    expect(created.cookie).toMatch(/^motor_city_session=/)
    expect(created.cookieHeader).toContain('HttpOnly')
    expect(created.cookieHeader).toContain('SameSite=Strict')
    expect(created.headers['cache-control']).toBe('no-store, max-age=0')
    expect(created.headers.pragma).toBe('no-cache')

    const restored = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(created.cookie),
    })
    expect(restored.statusCode).toBe(200)
    expect(restored.json()).toMatchObject({
      game: { id: created.game.id, status: 'waiting' },
      participant: { role: 'facilitator' },
      state: null,
    })
  })

  it('keeps each team player factory independent while sharing configuration', async () => {
    const app = makeApp()
    const created = await createSession(app)
    const playerA = await joinSession(app, created.game.code, 'Avery')
    const playerB = await joinSession(app, created.game.code, 'Blake')

    const start = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(created.cookie),
    })
    expect(start.statusCode).toBe(200)

    const move = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(playerA.cookie),
      payload: {
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        command: {
          type: 'move',
          carId: playerA.state.cars[0].id,
          toStage: 'manufacturing',
          toRow: 0,
        },
      },
    })
    expect(move.statusCode).toBe(200)
    expect(move.json().state.cars).toHaveLength(5)

    const slide = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(playerA.cookie),
      payload: {
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        command: {
          type: 'reposition',
          carId: playerA.state.cars[0].id,
          toRow: 6,
        },
      },
    })
    expect(slide.statusCode).toBe(200)
    const slid = slide.json().state.cars.find(
      (car: { id: string }) => car.id === playerA.state.cars[0].id,
    )
    expect(slid).toMatchObject({ stage: 'manufacturing', row: 6 })
    // A slide re-orders a station; it must never mint another car.
    expect(slide.json().state.cars).toHaveLength(5)

    const occupiedLane = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(playerA.cookie),
      payload: {
        expectedVersion: 2,
        idempotencyKey: randomUUID(),
        command: { type: 'reposition', carId: playerA.state.cars[1].id, toRow: 1 },
      },
    })
    expect(occupiedLane.statusCode).toBe(422)
    expect(occupiedLane.json().error.code).toBe('INVALID_MOVE')

    const offBoard = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(playerA.cookie),
      payload: {
        expectedVersion: 2,
        idempotencyKey: randomUUID(),
        command: { type: 'reposition', carId: playerA.state.cars[1].id, toRow: 9 },
      },
    })
    expect(offBoard.statusCode).toBe(400)

    const restoredB = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(playerB.cookie),
    })
    expect(restoredB.json().state.cars).toHaveLength(4)
    expect(restoredB.json().stateVersion).toBe(0)
    expect(restoredB.json().state.config.resourceSchedule).toEqual(
      playerA.state.config.resourceSchedule,
    )
  })

  it('cannot commit an in-memory command after the facilitator finishes', async () => {
    const store = new PausedCleanupStore()
    const app = buildApp(store)
    apps.push(app)
    const created = await createSession(app)
    const player = await joinSession(app, created.game.code, 'Avery')
    await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(created.cookie),
    })

    const pause = store.pauseNextCleanup()
    const commandPromise = app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: {
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        command: { type: 'allocate' },
      },
    })
    await pause.started

    const ended = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/end`,
      headers: auth(created.cookie),
      payload: { penaltyRound: 1, endRound: 1 },
    })
    expect(ended.statusCode).toBe(200)
    pause.release()

    const command = await commandPromise
    expect(command.statusCode).toBe(409)
    expect(command.json().error.code).toBe('GAME_NOT_ACTIVE')
  })

  it('replays a completed command after the facilitator ends the game', async () => {
    const app = makeApp()
    const created = await createSession(app)
    const player = await joinSession(app, created.game.code, 'Replay Player')
    await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(created.cookie),
    })
    const payload = {
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      command: { type: 'allocate' },
    }
    const command = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload,
    })
    expect(command.statusCode).toBe(200)
    await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/end`,
      headers: auth(created.cookie),
      payload: { penaltyRound: 1, endRound: 1 },
    })

    const retry = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload,
    })

    expect(retry.statusCode).toBe(200)
    expect(retry.json()).toMatchObject({ stateVersion: 1, repeated: true })
  })

  it('allocates, locks, and resets a player round when its timer expires', async () => {
    const app = makeApp()
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        facilitatorName: 'Morgan',
        enabledModels: ['blue'],
        resourcePlan: 'classic',
        penaltyRound: 2,
        endRound: 2,
        timer: {
          enabled: true,
          segments: [{ startRound: 1, endRound: 2, durationSeconds: 60 }],
        },
      },
    })
    const created = withCookie(createdResponse)
    const player = await joinSession(app, created.game.code, 'Timed Player')
    await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(created.cookie),
    })

    const started = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(player.cookie),
    })
    expect(started.json().participant).toMatchObject({
      roundTimedOut: false,
    })
    expect(started.json().participant.roundStartedAt).toBeTruthy()

    const moveIdempotencyKey = randomUUID()
    const movePayload = {
      expectedVersion: 0,
      idempotencyKey: moveIdempotencyKey,
      command: {
        type: 'move',
        carId: player.state.cars[0].id,
        toStage: 'manufacturing',
        toRow: 0,
      },
    }
    const move = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: movePayload,
    })
    expect(move.statusCode).toBe(200)

    const early = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: {
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        command: { type: 'timeout' },
      },
    })
    expect(early.statusCode).toBe(409)
    expect(early.json().error.code).toBe('ROUND_TIME_REMAINING')

    const future = Date.now() + 61_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(future)
    const retriedMove = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: movePayload,
    })
    expect(retriedMove.statusCode).toBe(200)
    expect(retriedMove.json()).toMatchObject({
      stateVersion: 1,
      repeated: true,
      roundTimedOut: false,
    })
    const expired = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: {
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        command: { type: 'timeout' },
      },
    })
    nowSpy.mockRestore()
    expect(expired.statusCode).toBe(200)
    expect(expired.json()).toMatchObject({
      stateVersion: 2,
      roundTimedOut: true,
    })
    const manufacturingCar = expired.json().state.cars.find(
      (car: { stage: string }) => car.stage === 'manufacturing',
    )
    expect(manufacturingCar.resources.red).toBe(3)
    expect(expired.json().state.round).toBe(0)

    const locked = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: {
        expectedVersion: 2,
        idempotencyKey: randomUUID(),
        command: { type: 'allocate' },
      },
    })
    expect(locked.statusCode).toBe(409)
    expect(locked.json().error.code).toBe('ROUND_TIME_EXPIRED')

    const advanced = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: {
        expectedVersion: 2,
        idempotencyKey: randomUUID(),
        command: { type: 'advance' },
      },
    })
    expect(advanced.statusCode).toBe(200)
    expect(advanced.json()).toMatchObject({
      stateVersion: 3,
      roundTimedOut: false,
      state: { round: 1 },
    })
    expect(advanced.json().roundStartedAt).toBeTruthy()
  })

  it('materializes overdue timers before the facilitator ends and reports', async () => {
    const app = makeApp()
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        facilitatorName: 'Morgan',
        enabledModels: ['blue'],
        resourcePlan: 'classic',
        penaltyRound: 1,
        endRound: 1,
        timer: {
          enabled: true,
          segments: [{ startRound: 1, endRound: 1, durationSeconds: 60 }],
        },
      },
    })
    const created = withCookie(createdResponse)
    const player = await joinSession(app, created.game.code, 'Timed Report')
    await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(created.cookie),
    })
    await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: {
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        command: {
          type: 'move',
          carId: player.state.cars[0].id,
          toStage: 'manufacturing',
          toRow: 0,
        },
      },
    })

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000)
    const ended = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/end`,
      headers: auth(created.cookie),
      payload: { penaltyRound: 1, endRound: 1 },
    })
    nowSpy.mockRestore()
    expect(ended.statusCode).toBe(200)

    const restored = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(player.cookie),
    })
    const car = restored.json().state.cars.find(
      (candidate: { stage: string }) => candidate.stage === 'manufacturing',
    )
    expect(car.resources.red).toBe(3)
    expect(restored.json().participant.roundTimedOut).toBe(true)
  })

  it('conceals penalty economics from players until the final report', async () => {
    const app = makeApp()
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        facilitatorName: 'Morgan',
        enabledModels: ['blue'],
        resourcePlan: 'classic',
        wipPenalty: { blue: 9, green: 8, red: 7, yellow: 6 },
        notes: 'Facilitator-only observation',
      },
    })
    expect(createdResponse.statusCode).toBe(201)
    const created = withCookie(createdResponse)
    expect(created.game.config.wipPenalty.blue).toBe(9)

    const player = await joinSession(
      app,
      created.game.code,
      'Avery',
      'avery@example.edu',
    )
    const hidden = { blue: 0, green: 0, red: 0, yellow: 0 }
    expect(player.game.config.wipPenalty).toEqual(hidden)
    expect(player.state.config.wipPenalty).toEqual(hidden)

    await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(created.cookie),
    })
    const move = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: {
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        command: {
          type: 'move',
          carId: player.state.cars[0].id,
          toStage: 'manufacturing',
          toRow: 0,
        },
      },
    })
    expect(move.statusCode).toBe(200)
    const advance = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: {
        expectedVersion: 1,
        idempotencyKey: randomUUID(),
        command: { type: 'advance' },
      },
    })
    expect(advance.statusCode).toBe(200)
    expect(advance.json().state.config.wipPenalty).toEqual(hidden)
    expect(advance.json().state.history[0].projectedPenalty).toBe(0)

    const ended = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/end`,
      headers: auth(created.cookie),
      payload: { penaltyRound: 1, endRound: 1 },
    })
    expect(ended.statusCode).toBe(200)
    expect(ended.json().report.players[0].identifier).toBe('avery@example.edu')

    const finalReport = await app.inject({
      method: 'GET',
      url: `/api/games/${created.game.id}/report`,
      headers: auth(player.cookie),
    })
    expect(finalReport.statusCode).toBe(200)
    expect(finalReport.json().players[0].projectedPenalty).toBe(9)
    expect(finalReport.json().players[0].identifier).toBeNull()
    expect(finalReport.json().game.config.notes).toBe('')
    expect(finalReport.json().game.config.wipPenalty.blue).toBe(9)

    const finalLastSeen = finalReport.json().players[0].lastSeenAt
    const restoredFinished = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(player.cookie),
    })
    expect(restoredFinished.statusCode).toBe(200)
    expect(restoredFinished.json().participant.lastSeenAt).toBe(finalLastSeen)

    const rejoinedFinishedResponse = await app.inject({
      method: 'POST',
      url: '/api/games/rejoin',
      payload: {
        code: created.game.code,
        playerName: 'Avery',
        recoveryCode: player.recoveryCode,
      },
    })
    expect(rejoinedFinishedResponse.statusCode).toBe(200)
    const rejoinedFinished = withCookie(rejoinedFinishedResponse)
    expect(rejoinedFinished.participant.lastSeenAt).toBe(finalLastSeen)

    const reportAfterRestore = await app.inject({
      method: 'GET',
      url: `/api/games/${created.game.id}/report`,
      headers: auth(rejoinedFinished.cookie),
    })
    expect(reportAfterRestore.statusCode).toBe(200)
    expect(reportAfterRestore.json().players[0].lastSeenAt).toBe(finalLastSeen)
  })

  it('creates and securely reuses the full facilitator setup', async () => {
    const app = makeApp()
    const emptyFreshSetup = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        facilitatorName: 'Nobody',
        enabledModels: [],
        resourcePlan: 'classic',
      },
    })
    expect(emptyFreshSetup.statusCode).toBe(400)

    const invalidTimer = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        facilitatorName: 'Nobody',
        enabledModels: ['blue'],
        resourcePlan: 'classic',
        penaltyRound: 8,
        endRound: 10,
        timer: {
          enabled: true,
          segments: [
            { startRound: 1, endRound: 5, durationSeconds: 600 },
            { startRound: 7, endRound: 10, durationSeconds: 300 },
          ],
        },
      },
    })
    expect(invalidTimer.statusCode).toBe(400)

    const originalResponse = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        facilitatorName: 'Morgan',
        enabledModels: ['green', 'yellow'],
        resourcePlan: 'evan',
        revenue: { blue: 3, green: 11, red: 2.5, yellow: 12 },
        wipPenalty: { blue: 1.5, green: 4, red: 1.25, yellow: 5 },
        notes: 'First cohort',
        penaltyRound: 20,
        endRound: 25,
        timer: {
          enabled: true,
          segments: [
            { startRound: 1, endRound: 5, durationSeconds: 600 },
            { startRound: 6, endRound: 25, durationSeconds: 300 },
          ],
        },
      },
    })
    expect(originalResponse.statusCode).toBe(201)
    const original = withCookie(originalResponse)
    expect(original.game.config).toMatchObject({
      enabledModels: ['green', 'yellow'],
      resourcePlan: 'evan',
      notes: 'First cohort',
      revenue: { green: 11, yellow: 12 },
      wipPenalty: { green: 4, yellow: 5 },
      timer: {
        enabled: true,
        segments: [
          { startRound: 1, endRound: 5, durationSeconds: 600 },
          { startRound: 6, endRound: 25, durationSeconds: 300 },
        ],
      },
    })
    expect(original.game).toMatchObject({ penaltyRound: 20, endRound: 25 })
    expect(original.game.config.resourceSchedule).toHaveLength(25)

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        facilitatorName: 'Taylor',
        enabledModels: [],
        resourcePlan: 'classic',
        reuse: {
          code: original.game.code,
          recoveryCode: 'incorrect-recovery-code',
        },
      },
    })
    expect(rejected.statusCode).toBe(401)
    expect(rejected.json().error.code).toBe('INVALID_REUSE_CREDENTIALS')

    const reusedResponse = await app.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        facilitatorName: 'Taylor',
        enabledModels: ['blue'],
        resourcePlan: 'classic',
        notes: 'Second cohort',
        penaltyRound: 1,
        endRound: 1,
        reuse: {
          code: original.game.code,
          recoveryCode: original.recoveryCode,
        },
      },
    })
    expect(reusedResponse.statusCode).toBe(201)
    const reused = withCookie(reusedResponse)
    expect(reused.game.config).toMatchObject({
      enabledModels: ['green', 'yellow'],
      resourcePlan: 'evan',
      notes: 'Second cohort',
      revenue: { green: 11, yellow: 12 },
      wipPenalty: { green: 4, yellow: 5 },
      timer: original.game.config.timer,
    })
    expect(reused.game).toMatchObject({ penaltyRound: 20, endRound: 25 })
    expect(reused.game.config.resourceSchedule).toEqual(
      original.game.config.resourceSchedule,
    )

    const player = await joinSession(app, reused.game.code, 'Avery')
    expect(player.game.config.notes).toBe('')
    expect(player.state.config.notes).toBe('')
    expect(player.game.penaltyRound).toBeNull()
    expect(player.game.endRound).toBe(25)
    expect(player.game.config.timer).toEqual(original.game.config.timer)
  })

  it('enforces facilitator lifecycle control and permits legacy-compatible active joins', async () => {
    const app = makeApp()
    const created = await createSession(app)
    const player = await joinSession(app, created.game.code, 'Casey')

    const playerStart = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(player.cookie),
    })
    expect(playerStart.statusCode).toBe(403)
    expect(playerStart.json().error.code).toBe('FACILITATOR_REQUIRED')

    const start = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(created.cookie),
    })
    expect(start.json().game.status).toBe('active')

    const latePlayer = await joinSession(app, created.game.code, 'Devon')
    expect(latePlayer.game.status).toBe('active')

    const end = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/end`,
      headers: auth(created.cookie),
      payload: { penaltyRound: 1, endRound: 1 },
    })
    expect(end.json().game.status).toBe('finished')

    const commandAfterEnd = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: {
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        command: { type: 'allocate' },
      },
    })
    expect(commandAfterEnd.statusCode).toBe(409)
  })

  it('rejects stale state and makes successful command retries idempotent', async () => {
    const app = makeApp()
    const created = await createSession(app)
    const player = await joinSession(app, created.game.code, 'Ellis')
    await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(created.cookie),
    })

    const payload = {
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      command: { type: 'allocate' },
    }
    const first = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload,
    })
    const retry = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload,
    })
    expect(first.json()).toMatchObject({ stateVersion: 1, repeated: false })
    expect(retry.json()).toMatchObject({ stateVersion: 1, repeated: true })
    expect(retry.json().state).toEqual(first.json().state)

    const stale = await app.inject({
      method: 'POST',
      url: '/api/player/commands',
      headers: auth(player.cookie),
      payload: {
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
        command: { type: 'advance' },
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('STALE_STATE')
  })

  it('validates input, names, authentication, and aggregated reports', async () => {
    const app = makeApp()
    const created = await createSession(app)
    const player = await joinSession(app, created.game.code, 'Frankie')

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/games/join',
      payload: { code: created.game.code, playerName: ' frankie ' },
    })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().error.code).toBe('NAME_IN_USE')

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/games/join',
      payload: { code: 'bad', playerName: '' },
    })
    expect(malformed.statusCode).toBe(400)

    const unauthorized = await app.inject({
      method: 'GET',
      url: `/api/games/${created.game.id}/report`,
      headers: auth('motor_city_session=not-a-real-token'),
    })
    expect(unauthorized.statusCode).toBe(401)

    const playerReport = await app.inject({
      method: 'GET',
      url: `/api/games/${created.game.id}/report`,
      headers: auth(player.cookie),
    })
    expect(playerReport.statusCode).toBe(403)
    expect(playerReport.json().error.code).toBe('REPORT_FORBIDDEN')

    const report = await app.inject({
      method: 'GET',
      url: `/api/games/${created.game.id}/report`,
      headers: auth(created.cookie),
    })
    expect(report.statusCode).toBe(200)
    expect(report.json().players).toEqual([
      expect.objectContaining({ name: 'Frankie', projectedScore: 0 }),
    ])
  })

  it('lets only the facilitator re-admit a player who lost their device', async () => {
    const app = makeApp()
    const created = await createSession(app)
    const player = await joinSession(app, created.game.code, 'Rowan')
    const other = await joinSession(app, created.game.code, 'Sasha')

    const asPlayer = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/participants/${player.participant.id}/recovery`,
      headers: auth(other.cookie),
    })
    expect(asPlayer.statusCode).toBe(403)
    expect(asPlayer.json().error.code).toBe('FACILITATOR_REQUIRED')

    const issued = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/participants/${player.participant.id}/recovery`,
      headers: auth(created.cookie),
    })
    expect(issued.statusCode).toBe(200)
    expect(issued.json()).toMatchObject({ name: 'Rowan' })
    const freshCode = issued.json().recoveryCode as string
    expect(freshCode).not.toBe(player.recoveryCode)

    // The code the student never had is now the only one that works.
    const staleAttempt = await app.inject({
      method: 'POST',
      url: '/api/games/rejoin',
      payload: {
        code: created.game.code,
        playerName: 'Rowan',
        recoveryCode: player.recoveryCode,
      },
    })
    expect(staleAttempt.statusCode).toBe(401)

    const rejoined = await app.inject({
      method: 'POST',
      url: '/api/games/rejoin',
      payload: {
        code: created.game.code,
        playerName: 'Rowan',
        recoveryCode: freshCode,
      },
    })
    expect(rejoined.statusCode).toBe(200)
    expect(rejoined.json().participant.name).toBe('Rowan')

    const strangerGame = await createSession(app)
    const crossSession = await app.inject({
      method: 'POST',
      url: `/api/games/${strangerGame.game.id}/participants/${player.participant.id}/recovery`,
      headers: auth(created.cookie),
    })
    expect(crossSession.statusCode).toBe(403)
  })

  it('lets only the facilitator remove a player, and never themselves', async () => {
    const app = makeApp()
    const created = await createSession(app)
    const player = await joinSession(app, created.game.code, 'Rowan')
    const other = await joinSession(app, created.game.code, 'Sasha')

    const asPlayer = await app.inject({
      method: 'DELETE',
      url: `/api/games/${created.game.id}/participants/${player.participant.id}`,
      headers: auth(other.cookie),
    })
    expect(asPlayer.statusCode).toBe(403)
    expect(asPlayer.json().error.code).toBe('FACILITATOR_REQUIRED')

    const self = await app.inject({
      method: 'DELETE',
      url: `/api/games/${created.game.id}/participants/${created.participant.id}`,
      headers: auth(created.cookie),
    })
    expect(self.statusCode).toBe(409)
    expect(self.json().error.code).toBe('CANNOT_REMOVE_SELF')

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/games/${created.game.id}/participants/${player.participant.id}`,
      headers: auth(created.cookie),
    })
    expect(removed.statusCode).toBe(200)
    expect(removed.json()).toMatchObject({ name: 'Rowan' })

    // The removed player is told what happened rather than silently signed out.
    const afterRemoval = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(player.cookie),
    })
    expect(afterRemoval.statusCode).toBe(401)
    expect(afterRemoval.json().error.code).toBe('SESSION_REMOVED')
    expect(afterRemoval.json().error.message).toContain('removed you')

    // Everyone else carries on.
    const bystander = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(other.cookie),
    })
    expect(bystander.statusCode).toBe(200)

    const facilitator = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(created.cookie),
    })
    expect(facilitator.statusCode).toBe(200)
    expect(facilitator.json().roster).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Rowan' })]),
    )

    const rejoin = await app.inject({
      method: 'POST',
      url: '/api/games/rejoin',
      payload: {
        code: created.game.code,
        playerName: 'Rowan',
        recoveryCode: player.recoveryCode,
      },
    })
    expect(rejoin.statusCode).toBe(401)
    expect(rejoin.json().error.code).toBe('INVALID_RECOVERY')
  })

  it('tells a player their screen was signed out because they continued elsewhere', async () => {
    const app = makeApp()
    const created = await createSession(app)
    const player = await joinSession(app, created.game.code, 'Rowan')

    const rejoined = await app.inject({
      method: 'POST',
      url: '/api/games/rejoin',
      payload: {
        code: created.game.code,
        playerName: 'Rowan',
        recoveryCode: player.recoveryCode,
      },
    })
    expect(rejoined.statusCode).toBe(200)

    const abandoned = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(player.cookie),
    })
    expect(abandoned.statusCode).toBe(401)
    expect(abandoned.json().error.code).toBe('SESSION_REJOINED')
    expect(abandoned.json().error.message).toContain('somewhere else')
  })

  it('exports the full round history after the session is locked', async () => {
    const app = makeApp()
    const created = await createSession(app)
    const player = await joinSession(app, created.game.code, 'Rowan')

    await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(created.cookie),
    })

    // Play a couple of rounds so there is something worth exporting.
    for (let version = 0; version < 2; version += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/player/commands',
        headers: auth(player.cookie),
        payload: {
          expectedVersion: version * 2,
          idempotencyKey: randomUUID(),
          command: { type: 'allocate' },
        },
      })
      await app.inject({
        method: 'POST',
        url: '/api/player/commands',
        headers: auth(player.cookie),
        payload: {
          expectedVersion: version * 2 + 1,
          idempotencyKey: randomUUID(),
          command: { type: 'advance' },
        },
      })
    }

    const ended = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/end`,
      headers: auth(created.cookie),
      payload: { penaltyRound: 1, endRound: 2 },
    })
    expect(ended.json().game.status).toBe('finished')

    const recoveryAfterFinish = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/participants/${player.participant.id}/recovery`,
      headers: auth(created.cookie),
    })
    expect(recoveryAfterFinish.statusCode).toBe(409)
    expect(recoveryAfterFinish.json().error.code).toBe('GAME_FINISHED')

    const removalAfterFinish = await app.inject({
      method: 'DELETE',
      url: `/api/games/${created.game.id}/participants/${player.participant.id}`,
      headers: auth(created.cookie),
    })
    expect(removalAfterFinish.statusCode).toBe(409)
    expect(removalAfterFinish.json().error.code).toBe('GAME_FINISHED')

    // The whole point: the export still works once the game is locked.
    const exported = await app.inject({
      method: 'GET',
      url: `/api/games/${created.game.id}/export`,
      headers: auth(created.cookie),
    })
    expect(exported.statusCode).toBe(200)

    const [exportedPlayer] = exported.json().players
    expect(exportedPlayer.name).toBe('Rowan')
    expect(exportedPlayer.history.length).toBeGreaterThan(1)
    expect(exportedPlayer.peakWip).toBeDefined()
    expect(exportedPlayer.averageWip).toBeDefined()

    const [firstRound] = exportedPlayer.history
    expect(firstRound.stations).toBeDefined()
    expect(firstRound.issuedResources).toBeDefined()
    expect(firstRound.convertedResources).toBeDefined()

    const playerHistory = await app.inject({
      method: 'GET',
      url: `/api/games/${created.game.id}/participants/${player.participant.id}/history`,
      headers: auth(created.cookie),
    })
    expect(playerHistory.statusCode).toBe(200)
    expect(playerHistory.json()).toMatchObject({
      id: player.participant.id,
      name: 'Rowan',
    })
    expect(playerHistory.json().history.length).toBe(exportedPlayer.history.length)
    expect(playerHistory.json().history[0].stations).toBeDefined()

    const historyAsPlayer = await app.inject({
      method: 'GET',
      url: `/api/games/${created.game.id}/participants/${player.participant.id}/history`,
      headers: auth(player.cookie),
    })
    expect(historyAsPlayer.statusCode).toBe(403)
    expect(historyAsPlayer.json().error.code).toBe('FACILITATOR_REQUIRED')

    // A player must not be able to pull everyone else's record.
    const asPlayer = await app.inject({
      method: 'GET',
      url: `/api/games/${created.game.id}/export`,
      headers: auth(player.cookie),
    })
    expect(asPlayer.statusCode).toBe(403)
    expect(asPlayer.json().error.code).toBe('FACILITATOR_REQUIRED')
  })

  it('rotates recovery credentials and revokes browser sessions', async () => {
    const app = makeApp()
    const created = await createSession(app)
    const player = await joinSession(app, created.game.code, 'Harper')

    const rejoinResponse = await app.inject({
      method: 'POST',
      url: '/api/games/rejoin',
      payload: {
        code: created.game.code,
        playerName: 'Harper',
        recoveryCode: player.recoveryCode,
      },
    })
    expect(rejoinResponse.statusCode).toBe(200)
    const rejoined = withCookie(rejoinResponse)
    expect(rejoined.recoveryCode).not.toBe(player.recoveryCode)

    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(player.cookie),
    })
    expect(oldSession.statusCode).toBe(401)

    const revoke = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: auth(rejoined.cookie),
    })
    expect(revoke.statusCode).toBe(204)

    const revokedSession = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(rejoined.cookie),
    })
    expect(revokedSession.statusCode).toBe(401)
  })

  it('recovers facilitator sessions and rejects report rounds beyond play', async () => {
    const app = makeApp()
    const created = await createSession(app)
    await joinSession(app, created.game.code, 'Indigo')

    const rejoinResponse = await app.inject({
      method: 'POST',
      url: '/api/games/rejoin',
      payload: {
        code: created.game.code,
        playerName: 'Morgan',
        recoveryCode: created.recoveryCode,
      },
    })
    expect(rejoinResponse.statusCode).toBe(200)
    const facilitator = withCookie(rejoinResponse)
    expect(facilitator.participant.role).toBe('facilitator')

    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(created.cookie),
    })
    expect(oldSession.statusCode).toBe(401)

    await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/start`,
      headers: auth(facilitator.cookie),
    })
    const invalidEnd = await app.inject({
      method: 'POST',
      url: `/api/games/${created.game.id}/end`,
      headers: auth(facilitator.cookie),
      payload: { penaltyRound: 2, endRound: 2 },
    })
    expect(invalidEnd.statusCode).toBe(422)
    expect(invalidEnd.json().error.code).toBe('INVALID_REPORT_ROUND')

    const session = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: auth(facilitator.cookie),
    })
    expect(session.json().game.status).toBe('active')
  })

  it('expires sessions and rejects oversized request bodies', async () => {
    const initialTime = Date.parse('2026-07-31T12:00:00Z')
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(initialTime)
    try {
      const app = makeApp()
      const created = await createSession(app)
      nowSpy.mockReturnValue(initialTime + SESSION_TTL_MS + 1)

      const expired = await app.inject({
        method: 'GET',
        url: '/api/session',
        headers: auth(created.cookie),
      })
      expect(expired.statusCode).toBe(401)
      expect(expired.json().error.code).toBe('SESSION_EXPIRED')

      const oversized = await app.inject({
        method: 'POST',
        url: '/api/games',
        payload: {
          facilitatorName: 'X'.repeat(20_000),
          enabledModels: ['blue'],
          resourcePlan: 'classic',
        },
      })
      expect(oversized.statusCode).toBe(413)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('deletes expired in-memory games and their join codes', async () => {
    const nowSpy = vi.spyOn(Date, 'now')
    try {
      const store = new InMemorySessionStore()
      const app = buildApp(store)
      apps.push(app)
      const created = await createSession(app)
      nowSpy.mockReturnValue(
        Date.parse(created.game.createdAt) + SESSION_TTL_MS + 1,
      )

      await store.cleanupExpiredData()

      const join = await app.inject({
        method: 'POST',
        url: '/api/games/join',
        payload: { code: created.game.code, playerName: 'Too Late' },
      })
      expect(join.statusCode).toBe(404)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('serves SPA routes with restrictive production security headers', async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), 'motor-city-static-'))
    directories.push(staticRoot)
    await writeFile(
      join(staticRoot, 'index.html'),
      '<!doctype html><title>Motor City Test</title>',
    )
    const app = makeApp({ staticRoot })

    const response = await app.inject({
      method: 'GET',
      url: '/facilitator/session',
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Motor City Test')
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    )
    expect(response.headers['content-security-policy']).toContain(
      "style-src-attr 'unsafe-inline'",
    )
    expect(response.headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests',
    )
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['strict-transport-security']).toBe('max-age=0')

    const coldLoads = await Promise.all(
      Array.from({ length: 320 }, () => app.inject({
        method: 'GET',
        url: '/facilitator/session',
        remoteAddress: '203.0.113.20',
      })),
    )
    expect(coldLoads.every((load) => load.statusCode === 200)).toBe(true)
    expect(coldLoads[319].headers['x-ratelimit-limit']).toBeUndefined()
  })
})