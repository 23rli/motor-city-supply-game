import { z } from 'zod'

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true')

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
  if (Boolean(data.DATABASE_URL) !== Boolean(data.DATABASE_SSL_CA)) {
    context.addIssue({
      code: 'custom',
      message: 'DATABASE_URL and DATABASE_SSL_CA must be configured together.',
    })
  }
  if (data.NODE_ENV === 'production' && !data.DATABASE_URL) {
    context.addIssue({
      code: 'custom',
      message: 'Production requires managed PostgreSQL configuration.',
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