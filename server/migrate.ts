import { readServerConfig } from './config'
import { ManagedPostgresSqlClient } from './db/client'
import { INITIAL_SCHEMA_SQL } from './db/schema'

const config = readServerConfig(process.env)
if (!config.databaseUrl || !config.databaseSslCa) {
  throw new Error('Managed PostgreSQL configuration is required for migrations.')
}

const client = new ManagedPostgresSqlClient({
  connectionString: config.databaseUrl,
  certificateAuthority: config.databaseSslCa,
  maxConnections: 1,
})

try {
  await client.exec(INITIAL_SCHEMA_SQL)
  console.log('Motor City database migration completed.')
} finally {
  await client.close()
}