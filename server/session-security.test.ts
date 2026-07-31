import { describe, expect, it } from 'vitest'
import { isSessionExpired } from './session-security'

describe('session expiry', () => {
  it('fails closed for malformed expiration timestamps', () => {
    expect(isSessionExpired('not-a-timestamp')).toBe(true)
  })
})