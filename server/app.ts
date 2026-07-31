import fastifyCookie from '@fastify/cookie'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { resolve } from 'node:path'
import { z } from 'zod'
import {
  createSessionSchema,
  endSessionSchema,
  gameParamsSchema,
  joinSessionSchema,
  playerCommandSchema,
  rejoinSessionSchema,
} from './contracts'
import {
  ApiError,
  InMemorySessionStore,
  type SessionStore,
} from './session-store-core'
import { hashSecret, SESSION_TTL_MS } from './session-security'

const SESSION_COOKIE = 'motor_city_session'

interface AppOptions {
  cleanupIntervalMs?: number
  cookieSecure?: boolean
  staticRoot?: string
  trustProxy?: boolean
  logger?: boolean
}

const isHttpClientError = (
  error: unknown,
): error is { statusCode: number; code?: string } =>
  typeof error === 'object'
  && error !== null
  && 'statusCode' in error
  && typeof error.statusCode === 'number'
  && error.statusCode >= 400
  && error.statusCode < 500

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ApiError(
      400,
      'INVALID_REQUEST',
      result.error.issues.map((issue) => issue.message).join(' '),
    )
  }
  return result.data
}

const sessionToken = (request: FastifyRequest) => {
  const cookieToken = request.cookies[SESSION_COOKIE]
  if (cookieToken) return cookieToken
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    throw new ApiError(401, 'INVALID_SESSION', 'A session cookie or bearer token is required.')
  }
  const token = authorization.slice('Bearer '.length).trim()
  if (!token) throw new ApiError(401, 'INVALID_SESSION', 'A session cookie or bearer token is required.')
  return token
}

const setSessionCookie = (
  reply: FastifyReply,
  token: string,
  secure: boolean,
) => {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/api',
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: Math.floor(SESSION_TTL_MS / 1_000),
  })
}

const rateLimitKey = (request: FastifyRequest) => {
  const cookieToken = request.cookies[SESSION_COOKIE]
  const authorization = request.headers.authorization
  const bearerToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : undefined
  const token = cookieToken || bearerToken
  return token
    ? `session:${hashSecret(token)}`
    : `ip:${request.ip}`
}

const credentialRouteConfig = {
  rateLimit: {
    max: 20,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) => `ip:${request.ip}`,
  },
}

export function buildApp(
  store: SessionStore = new InMemorySessionStore(),
  options: AppOptions = {},
) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 16 * 1_024,
    trustProxy: options.trustProxy ?? false,
  })
  void app.register(fastifyCookie)
  void app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  })
  void app.register(fastifyRateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKey,
  })
  if (options.staticRoot) {
    void app.register(fastifyStatic, {
      root: resolve(options.staticRoot),
      wildcard: false,
    })
  }

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/') && request.url !== '/api/health') {
      reply.header('Cache-Control', 'no-store, max-age=0')
      reply.header('Pragma', 'no-cache')
      reply.header('Expires', '0')
    }
    return payload
  })

  const cleanupIntervalMs = options.cleanupIntervalMs ?? 60 * 60 * 1_000
  let cleanupTimer: NodeJS.Timeout | undefined
  if (store.cleanupExpiredData) {
    app.addHook('onReady', async () => {
      await store.cleanupExpiredData?.()
    })
    if (cleanupIntervalMs > 0) {
      cleanupTimer = setInterval(() => {
        void store.cleanupExpiredData?.().catch((error: unknown) => {
          app.log.error(error)
        })
      }, cleanupIntervalMs)
      cleanupTimer.unref()
    }
  }

  app.addHook('onClose', async () => {
    if (cleanupTimer) clearInterval(cleanupTimer)
    await store.close?.()
  })

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      })
    }
    if (isHttpClientError(error)) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code ?? 'REQUEST_REJECTED',
          message: error.statusCode === 413
            ? 'The request body exceeds the 16 KB limit.'
            : 'The request was rejected.',
        },
      })
    }
    app.log.error(error)
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'The server could not complete the request.' },
    })
  })

  app.get('/api/health', async () => ({ status: 'ok' }))

  app.post('/api/games', { config: credentialRouteConfig }, async (request, reply) => {
    const input = parse(createSessionSchema, request.body)
    const issued = await store.createSession(input)
    setSessionCookie(reply, issued.token, options.cookieSecure ?? false)
    const { token: _token, ...response } = issued
    return reply.status(201).send(response)
  })

  app.post('/api/games/join', { config: credentialRouteConfig }, async (request, reply) => {
    const input = parse(joinSessionSchema, request.body)
    const issued = await store.joinSession(input)
    setSessionCookie(reply, issued.token, options.cookieSecure ?? false)
    const { token: _token, ...response } = issued
    return reply.status(201).send(response)
  })

  app.post('/api/games/rejoin', { config: credentialRouteConfig }, async (request, reply) => {
    const input = parse(rejoinSessionSchema, request.body)
    const issued = await store.rejoinSession(input)
    setSessionCookie(reply, issued.token, options.cookieSecure ?? false)
    const { token: _token, ...response } = issued
    return reply.status(200).send(response)
  })

  app.get('/api/session', async (request) => {
    return store.getSession(sessionToken(request))
  })

  app.delete('/api/session', async (request, reply) => {
    await store.revokeSession(sessionToken(request))
    reply.clearCookie(SESSION_COOKIE, { path: '/api' })
    return reply.status(204).send()
  })

  app.post('/api/games/:gameId/start', async (request) => {
    const { gameId } = parse(gameParamsSchema, request.params)
    return {
      game: await store.startSession(
        sessionToken(request),
        gameId,
      ),
    }
  })

  app.post('/api/games/:gameId/end', async (request) => {
    const { gameId } = parse(gameParamsSchema, request.params)
    const input = parse(endSessionSchema, request.body)
    return store.endSession(
      sessionToken(request),
      gameId,
      input,
    )
  })

  app.post('/api/player/commands', async (request) => {
    const input = parse(playerCommandSchema, request.body)
    return store.executeCommand(
      sessionToken(request),
      input,
    )
  })

  app.get('/api/games/:gameId/report', async (request) => {
    const { gameId } = parse(gameParamsSchema, request.params)
    return store.getReport(
      sessionToken(request),
      gameId,
    )
  })

  app.setNotFoundHandler((request, reply) => {
    if (
      options.staticRoot
      && request.method === 'GET'
      && !request.url.startsWith('/api/')
    ) {
      return reply.sendFile('index.html')
    }
    return reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
    })
  })

  return app
}