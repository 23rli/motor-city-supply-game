import { describe, expect, it } from 'vitest'
import type { TeamSessionSnapshot } from './types'
import { shouldApplySessionSnapshot } from './sessionSnapshot'

const snapshot = (stateVersion: number, status: 'waiting' | 'active' | 'finished' = 'active') => ({
  serverNow: '2026-08-26T12:00:00.000Z',
  game: {
    id: 'game',
    code: 'ABC234',
    status,
    config: {} as TeamSessionSnapshot['game']['config'],
    createdAt: '2026-08-26T12:00:00.000Z',
    startedAt: '2026-08-26T12:01:00.000Z',
    endedAt: status === 'finished' ? '2026-08-26T12:10:00.000Z' : null,
    penaltyRound: 10,
    endRound: 10,
  },
  participant: {
    id: 'player',
    name: 'Player',
    role: 'player',
    stateVersion,
    joinedAt: '2026-08-26T12:00:30.000Z',
    lastSeenAt: '2026-08-26T12:02:00.000Z',
    roundStartedAt: '2026-08-26T12:01:00.000Z',
    roundTimedOut: false,
  },
  roster: [],
  state: null,
  stateVersion,
}) satisfies TeamSessionSnapshot

describe('team session snapshot ordering', () => {
  it('rejects a poll response older than a completed command', () => {
    expect(shouldApplySessionSnapshot(snapshot(2), snapshot(1))).toBe(false)
  })

  it('accepts newer state and lifecycle changes at the same version', () => {
    expect(shouldApplySessionSnapshot(snapshot(1), snapshot(2))).toBe(true)
    expect(
      shouldApplySessionSnapshot(snapshot(2, 'active'), snapshot(2, 'finished')),
    ).toBe(true)
  })
})