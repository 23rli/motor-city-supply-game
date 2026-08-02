import { mkdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { buildApp } from './app'
import { readServerConfig } from './config'
import {
  ManagedPostgresSqlClient,
  PGliteSqlClient,
  type SqlClient,
} from './db/client'
import { SqlSessionStore } from './pglite-session-store'

const config = readServerConfig(process.env)
let sqlClient: SqlClient
if (config.databaseUrl) {
  sqlClient = new ManagedPostgresSqlClient({
    connectionString: config.databaseUrl,
    certificateAuthority: config.databaseSslCa,
    maxConnections: config.databaseMaxConnections,
  })
} else {
  if (!config.dataDirectory.includes('://')) {
    await mkdir(config.dataDirectory, { recursive: true })
  }
  sqlClient = new PGliteSqlClient(new PGlite(config.dataDirectory))
}
const store = await SqlSessionStore.create(sqlClient, {
  initializeSchema: config.databaseUrl
    ? config.migrateOnStart
    : true,
})
const app = buildApp(store, {
  cookieSecure: config.cookieSecure,
  staticRoot: config.nodeEnvironment === 'production'
    ? config.staticRoot
    : undefined,
  trustProxy: config.nodeEnvironment === 'production',
  logger: true,
})

const close = async () => {
  await app.close()
  process.exit(0)
}

process.on('SIGINT', close)
process.on('SIGTERM', close)

await app.listen({ port: config.port, host: config.host })
console.log(`Motor City API listening on http://${config.host}:${config.port}`)