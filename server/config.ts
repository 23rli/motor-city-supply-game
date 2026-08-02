import { z } from 'zod'

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true')

/** A database on this host needs no TLS; anything reached over a network does. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', ''])

export function databaseIsLoopback(connectionString: string) {
  try {
    // URL keeps IPv6 literals bracketed, e.g. "[::1]".
    const host = new URL(connectionString).hostname.replace(/^\[|\]$/g, '')
    return LOOPBACK_HOSTS.has(host)
  } catch {
    return false
  }
}

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PGLITE_DATA_DIR: z.string().trim().min(1).default('./data/motor-city'),
  COOKIE_SECURE: booleanString.optional(),
  DATABASE_URL: z.string().trim().min(1).optional(),
  DATABASE_SSL_CA: z.string().trim().min(1).optional(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
  STATIC_ROOT: z.string().trim().min(1).default('./dist'),
  MIGRATE_ON_START: booleanString.default(false),
}).passthrough().superRefine((data, context) => {
  if (data.DATABASE_SSL_CA && !data.DATABASE_URL) {
    context.addIssue({
      code: 'custom',
      message: 'DATABASE_SSL_CA needs a DATABASE_URL to apply to.',
    })
  }
  if (
    data.DATABASE_URL
    && !data.DATABASE_SSL_CA
    && !databaseIsLoopback(data.DATABASE_URL)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'A database reached over the network requires DATABASE_SSL_CA.',
    })
  }
  if (data.NODE_ENV === 'production' && !data.DATABASE_URL) {
    context.addIssue({
      code: 'custom',
      message: 'Production requires PostgreSQL configuration.',
    })
  }
})

export function readServerConfig(environment: NodeJS.ProcessEnv) {
  const parsed = environmentSchema.safeParse(environment)
  if (!parsed.success) {
    throw new Error(
      `Invalid server configuration: ${parsed.error.issues.map((issue) => issue.message).join(' ')}`,
    )
  }
  return {
    nodeEnvironment: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    dataDirectory: parsed.data.PGLITE_DATA_DIR,
    cookieSecure: parsed.data.COOKIE_SECURE
      ?? parsed.data.NODE_ENV === 'production',
    databaseUrl: parsed.data.DATABASE_URL,
    databaseSslCa: parsed.data.DATABASE_SSL_CA,
    databaseMaxConnections: parsed.data.DATABASE_MAX_CONNECTIONS,
    staticRoot: parsed.data.STATIC_ROOT,
    migrateOnStart: parsed.data.MIGRATE_ON_START,
  }
}