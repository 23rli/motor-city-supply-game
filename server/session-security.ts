import { createHash, randomBytes } from 'node:crypto'

export const SESSION_TTL_MS = 12 * 60 * 60 * 1_000

export const hashSecret = (secret: string) =>
  createHash('sha256').update(secret).digest('hex')

export function issueSessionSecrets() {
  const issuedAt = Date.now()
  return {
    token: randomBytes(32).toString('base64url'),
    recoveryCode: randomBytes(18).toString('base64url'),
    tokenExpiresAt: new Date(issuedAt + SESSION_TTL_MS).toISOString(),
  }
}

export const isSessionExpired = (expiresAt: string) => {
  const expiration = Date.parse(expiresAt)
  return !Number.isFinite(expiration) || expiration <= Date.now()
}