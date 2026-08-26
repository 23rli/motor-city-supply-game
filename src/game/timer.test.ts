import { describe, expect, it } from 'vitest'
import {
  defaultEndRound,
  describeRoundTimer,
  originalTimerConfig,
  roundTimerDurationSeconds,
  validateTimerCoverage,
} from './timer'

describe('session plan defaults', () => {
  it('uses the full fixed schedule as the planned final round', () => {
    expect(defaultEndRound('classic')).toBe(10)
    expect(defaultEndRound('evan')).toBe(25)
    expect(defaultEndRound('random')).toBe(10)
  })

  it('recreates the v1 timing split without enabling it silently', () => {
    expect(originalTimerConfig(10)).toEqual({
      enabled: false,
      segments: [
        { startRound: 1, endRound: 8, durationSeconds: 600 },
        { startRound: 9, endRound: 10, durationSeconds: 180 },
      ],
    })
  })
})

describe('round timer schedule', () => {
  const timer = {
    enabled: true,
    segments: [
      { startRound: 1, endRound: 5, durationSeconds: 600 },
      { startRound: 6, endRound: 10, durationSeconds: 300 },
    ],
  }

  it('maps each player round to its configured duration', () => {
    expect(roundTimerDurationSeconds(timer, 1)).toBe(600)
    expect(roundTimerDurationSeconds(timer, 5)).toBe(600)
    expect(roundTimerDurationSeconds(timer, 6)).toBe(300)
    expect(roundTimerDurationSeconds(timer, 10)).toBe(300)
    expect(roundTimerDurationSeconds(timer, 11)).toBeNull()
    expect(roundTimerDurationSeconds({ ...timer, enabled: false }, 1)).toBeNull()
  })

  it('describes the plan in compact facilitator language', () => {
    expect(describeRoundTimer(timer)).toBe('R1-5: 10 min; R6-10: 5 min')
    expect(describeRoundTimer({ ...timer, enabled: false })).toBe('Off')
  })

  it('requires contiguous coverage through the planned final round', () => {
    expect(validateTimerCoverage(timer, 10)).toBeNull()
    expect(validateTimerCoverage({
      enabled: true,
      segments: [{ startRound: 2, endRound: 10, durationSeconds: 600 }],
    }, 10)).toMatch(/continue at round 1/)
    expect(validateTimerCoverage({
      enabled: true,
      segments: [{ startRound: 1, endRound: 9, durationSeconds: 600 }],
    }, 10)).toMatch(/end at round 10/)
  })
})