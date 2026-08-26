import { describe, expect, it } from 'vitest'
import type { PlayerCommandResponse } from './types'
import {
  commandPreemptedByTimeout,
  formatRoundCountdown,
  remainingRoundSeconds,
  roundTimerAnnouncement,
} from './roundTimer'

describe('player round countdown', () => {
  const started = '2026-08-26T10:00:00.000Z'

  it('counts from the server start time and stops at zero', () => {
    expect(remainingRoundSeconds(started, 600, Date.parse(started), false)).toBe(600)
    expect(remainingRoundSeconds(started, 600, Date.parse(started) + 61_000, false)).toBe(539)
    expect(remainingRoundSeconds(started, 600, Date.parse(started) + 700_000, false)).toBe(0)
  })

  it('stays absent when disabled and pinned at zero after timeout', () => {
    expect(remainingRoundSeconds(null, 600, Date.now(), false)).toBeNull()
    expect(remainingRoundSeconds(started, null, Date.now(), false)).toBeNull()
    expect(remainingRoundSeconds(started, 600, Date.parse(started), true)).toBe(0)
  })

  it('formats a large, readable countdown', () => {
    expect(formatRoundCountdown(600)).toBe('10:00')
    expect(formatRoundCountdown(65)).toBe('1:05')
    expect(formatRoundCountdown(0)).toBe('0:00')
  })

  it('distinguishes a deadline-preempted action from the timeout command itself', () => {
    const result = { roundTimedOut: true } as PlayerCommandResponse

    expect(commandPreemptedByTimeout({ type: 'allocate' }, result)).toBe(true)
    expect(commandPreemptedByTimeout({ type: 'timeout' }, result)).toBe(false)
  })

  it('announces useful thresholds without speaking every second', () => {
    expect(roundTimerAnnouncement(null, 600)).toBeNull()
    expect(roundTimerAnnouncement(61, 60)).toEqual({
      threshold: 60,
      message: 'One minute remaining.',
    })
    expect(roundTimerAnnouncement(60, 59)).toBeNull()
    expect(roundTimerAnnouncement(11, 9)).toEqual({
      threshold: 10,
      message: 'Ten seconds remaining.',
    })
  })
})