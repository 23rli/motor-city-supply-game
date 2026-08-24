import { describe, expect, it } from 'vitest'
import { formatElapsedTime } from './elapsed'

describe('facilitator elapsed clock', () => {
  it('waits for the session to start', () => {
    expect(formatElapsedTime(null, null)).toBe('00:00:00')
  })

  it('formats the live elapsed duration', () => {
    expect(formatElapsedTime('2026-08-24T10:00:00.000Z', null, Date.parse('2026-08-24T11:02:03.900Z')))
      .toBe('01:02:03')
  })

  it('freezes at the recorded end time', () => {
    expect(formatElapsedTime(
      '2026-08-24T10:00:00.000Z',
      '2026-08-24T10:12:34.000Z',
      Date.parse('2026-08-24T20:00:00.000Z'),
    )).toBe('00:12:34')
  })
})