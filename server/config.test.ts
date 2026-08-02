import { describe, expect, it } from 'vitest'
import { readServerConfig } from './config'

describe('server configuration', () => {
  it('validates and coerces local runtime values', () => {
    expect(readServerConfig({
      NODE_ENV: 'development',
      PORT: '4100',
      COOKIE_SECURE: 'true',
    })).toMatchObject({
      port: 4_100,
      host: '127.0.0.1',
      cookieSecure: true,
    })
  })

  it('rejects invalid ports and embedded production execution', () => {
    expect(() => readServerConfig({ PORT: 'not-a-port' })).toThrow(
      'Invalid server configuration',
    )
    expect(() => readServerConfig({ NODE_ENV: 'production' })).toThrow(
      'Production requires PostgreSQL',
    )
  })

  it('requires trusted TLS and secure cookies for managed production', () => {
    expect(readServerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://motor-city.internal/game',
      DATABASE_SSL_CA: 'trusted-rds-ca',
    })).toMatchObject({
      cookieSecure: true,
      databaseMaxConnections: 10,
    })
    expect(() => readServerConfig({
      DATABASE_URL: 'postgres://motor-city.internal/game',
    })).toThrow('reached over the network requires DATABASE_SSL_CA')
  })

  it('accepts a database on the same host without a certificate authority', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(readServerConfig({
        NODE_ENV: 'production',
        DATABASE_URL: `postgres://motor:secret@${host}:5432/motor_city`,
      })).toMatchObject({
        cookieSecure: true,
        databaseSslCa: undefined,
      })
    }
  })

  it('still refuses an unencrypted database anywhere but this host', () => {
    expect(() => readServerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://motor:secret@10.0.4.7:5432/motor_city',
    })).toThrow('reached over the network requires DATABASE_SSL_CA')
    expect(() => readServerConfig({
      DATABASE_SSL_CA: 'orphan-ca',
    })).toThrow('needs a DATABASE_URL')
  })
})