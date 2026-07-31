import { PGlite, type Transaction } from '@electric-sql/pglite'
import { Pool, type PoolClient } from 'pg'

export interface SqlRows<T> {
  rows: T[]
  affectedRows: number
}

export interface SqlExecutor {
  query<T>(text: string, values?: unknown[]): Promise<SqlRows<T>>
}

export interface SqlClient extends SqlExecutor {
  exec(text: string): Promise<void>
  transaction<T>(callback: (transaction: SqlExecutor) => Promise<T>): Promise<T>
  close(): Promise<void>
}

const pgliteExecutor = (client: PGlite | Transaction): SqlExecutor => ({
  async query<T>(text: string, values: unknown[] = []) {
    const result = await client.query<T>(text, values)
    return {
      rows: result.rows,
      affectedRows: result.affectedRows ?? 0,
    }
  },
})

export class PGliteSqlClient implements SqlClient {
  constructor(private readonly client: PGlite) {}

  async query<T>(text: string, values: unknown[] = []) {
    const result = await this.client.query<T>(text, values)
    return {
      rows: result.rows,
      affectedRows: result.affectedRows ?? 0,
    }
  }

  async exec(text: string) {
    await this.client.exec(text)
  }

  async transaction<T>(callback: (transaction: SqlExecutor) => Promise<T>) {
    return this.client.transaction((transaction) =>
      callback(pgliteExecutor(transaction)),
    )
  }

  async close() {
    await this.client.close()
  }
}

const poolExecutor = (client: PoolClient): SqlExecutor => ({
  async query<T>(text: string, values: unknown[] = []) {
    const result = await client.query(text, values)
    return {
      rows: result.rows as T[],
      affectedRows: result.rowCount ?? 0,
    }
  },
})

interface ManagedPostgresOptions {
  connectionString: string
  certificateAuthority: string
  maxConnections?: number
}

export class ManagedPostgresSqlClient implements SqlClient {
  private readonly pool: Pool

  constructor(options: ManagedPostgresOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
      ssl: {
        ca: options.certificateAuthority,
        rejectUnauthorized: true,
      },
    })
  }

  async query<T>(text: string, values: unknown[] = []) {
    const result = await this.pool.query(text, values)
    return {
      rows: result.rows as T[],
      affectedRows: result.rowCount ?? 0,
    }
  }

  async exec(text: string) {
    await this.pool.query(text)
  }

  async transaction<T>(callback: (transaction: SqlExecutor) => Promise<T>) {
    const connection = await this.pool.connect()
    try {
      await connection.query('BEGIN')
      const result = await callback(poolExecutor(connection))
      await connection.query('COMMIT')
      return result
    } catch (error) {
      await connection.query('ROLLBACK')
      throw error
    } finally {
      connection.release()
    }
  }

  async close() {
    await this.pool.end()
  }
}