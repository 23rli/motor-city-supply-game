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
  certificateAuthority?: string
  maxConnections?: number
}

export class ManagedPostgresSqlClient implements SqlClient {
  private readonly pool: Pool

  constructor(options: ManagedPostgresOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
      // No CA means a same-host database, where TLS adds nothing to verify against.
      ssl: options.certificateAuthority
        ? { ca: options.certificateAuthority, rejectUnauthorized: true }
        : false,
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
    let transactionOpen = false
    try {
      await connection.query('BEGIN')
      transactionOpen = true
      const result = await callback(poolExecutor(connection))
      await connection.query('COMMIT')
      transactionOpen = false
      return result
    } catch (error) {
      if (transactionOpen) {
        try {
          await connection.query('ROLLBACK')
        } catch {
          // Preserve the operation or commit error that made the outcome uncertain.
        }
      }
      throw error
    } finally {
      connection.release()
    }
  }

  async close() {
    await this.pool.end()
  }
}