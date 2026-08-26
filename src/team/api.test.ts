import { describe, expect, it } from 'vitest'
import { createIdempotencyKey } from './api'

describe('team API identifiers', () => {
  it('creates command keys accepted by the server contract', () => {
    expect(createIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})