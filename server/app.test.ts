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

const makeApp = (options: { staticRoot?: string } = {}) => {
  const app = buildApp(new InMemorySessionStore(), options)
  apps.push(app)
  return app
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
) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/games/join',
    payload: { code, playerName },
  })
  expect(response.statusCode).toBe(201)
  return withCookie(response)
}

describe('multiplayer API', () => {
  it('creates a waiting game and restores sessions from opaque tokens', async () => {
    const app = makeApp()
    const created = await createSession(app)

    expect(created.game.code).toMatch(/^[A-Z2-9]{6}$/)
    expect(created.game.status).toBe('waiting')
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
    await joinSession(app, created.game.code, 'Frankie')

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
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN')
  })
})