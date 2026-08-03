import { describe, expect, it } from 'vitest'
import { SORT_KEYS, podium, rankPlayers, rankSnapshot, sortLeaderboard } from './leaderboard'
import type { TeamPlayerReport } from './types'

const player = (
  id: string,
  name: string,
  projectedScore: number,
): TeamPlayerReport => ({
  id,
  name,
  identifier: null,
  round: 3,
  stateVersion: 1,
  completed: { blue: 0, green: 0, red: 0, yellow: 0 },
  wip: { blue: 0, green: 0, red: 0, yellow: 0 },
  revenue: projectedScore,
  projectedPenalty: 0,
  projectedScore,
  lastSeenAt: new Date().toISOString(),
  scoredThroughRound: 3,
  penaltyMeasuredAtRound: 3,
  peakWip: 0,
  averageWip: 0,
  throughput: 0,
  currentRound: 3,
  stranded: { red: 0, yellow: 0, blue: 0 },
  paint: { occupancy: 0, curing: false, cured: 0 },
})

describe('facilitator leaderboard', () => {
  it('orders by score with the leader first', () => {
    const ranked = rankPlayers([
      player('a', 'Ada', 120),
      player('b', 'Bo', 300),
      player('c', 'Cy', 200),
    ])

    expect(ranked.map((entry) => [entry.rank, entry.player.name])).toEqual([
      [1, 'Bo'],
      [2, 'Cy'],
      [3, 'Ada'],
    ])
    expect(ranked.map((entry) => entry.behindLeader)).toEqual([0, 100, 180])
  })

  it('lets tied players share a place and skips the next one', () => {
    const ranked = rankPlayers([
      player('a', 'Ada', 200),
      player('b', 'Bo', 200),
      player('c', 'Cy', 100),
    ])

    expect(ranked.map((entry) => entry.rank)).toEqual([1, 1, 3])
  })

  it('keeps a stable order for equal scores so the board does not jitter', () => {
    const first = rankPlayers([player('b', 'Bo', 50), player('a', 'Ada', 50)])
    const second = rankPlayers([player('a', 'Ada', 50), player('b', 'Bo', 50)])

    expect(first.map((entry) => entry.player.id)).toEqual(
      second.map((entry) => entry.player.id),
    )
  })

  it('reports which way each player moved since the previous poll', () => {
    const before = rankPlayers([
      player('a', 'Ada', 300),
      player('b', 'Bo', 200),
      player('c', 'Cy', 100),
    ])

    const after = rankPlayers(
      [player('a', 'Ada', 300), player('b', 'Bo', 200), player('c', 'Cy', 400)],
      rankSnapshot(before),
    )

    const movementByName = Object.fromEntries(
      after.map((entry) => [entry.player.name, entry.movement]),
    )
    expect(movementByName).toEqual({ Cy: 'up', Ada: 'down', Bo: 'down' })
  })

  it('marks a player the facilitator has not seen before as new', () => {
    const before = rankPlayers([player('a', 'Ada', 300)])
    const after = rankPlayers(
      [player('a', 'Ada', 300), player('z', 'Zed', 10)],
      rankSnapshot(before),
    )

    expect(after.find((entry) => entry.player.name === 'Zed')?.movement).toBe('new')
    expect(after.find((entry) => entry.player.name === 'Ada')?.movement).toBe('level')
  })

  it('handles an empty board without inventing a leader', () => {
    expect(rankPlayers([])).toEqual([])
    expect(podium([])).toEqual([])
  })

  it('extends the podium when players tie into third place', () => {
    const ranked = rankPlayers([
      player('a', 'Ada', 400),
      player('b', 'Bo', 300),
      player('c', 'Cy', 200),
      player('d', 'Di', 200),
      player('e', 'Eve', 100),
    ])

    expect(podium(ranked).map((entry) => entry.player.name)).toEqual([
      'Ada',
      'Bo',
      'Cy',
      'Di',
    ])
  })
})

describe('leaderboard sorting', () => {
  const ranked = () => rankPlayers([
    player('a', 'Cy', 100),
    player('b', 'Ada', 300),
    player('c', 'Bo', 200),
  ])

  it('sorts by name without disturbing the rank each player earned', () => {
    const sorted = sortLeaderboard(ranked(), 'name', 'asc')

    expect(sorted.map((entry) => entry.player.name)).toEqual(['Ada', 'Bo', 'Cy'])
    expect(sorted.map((entry) => entry.rank)).toEqual([1, 2, 3])
  })

  it('reverses on the second click', () => {
    const ascending = sortLeaderboard(ranked(), 'score', 'asc')
    const descending = sortLeaderboard(ranked(), 'score', 'desc')

    expect(ascending.map((entry) => entry.player.name)).toEqual(['Cy', 'Bo', 'Ada'])
    expect(descending.map((entry) => entry.player.name)).toEqual(['Ada', 'Bo', 'Cy'])
  })

  it('keeps a stable order when a column ties', () => {
    const tied = rankPlayers([
      player('z', 'Zed', 50),
      player('a', 'Ada', 50),
      player('m', 'Mo', 50),
    ])

    expect(sortLeaderboard(tied, 'score', 'desc').map((entry) => entry.player.name))
      .toEqual(['Ada', 'Mo', 'Zed'])
  })

  it('never mutates the array it was given', () => {
    const original = ranked()
    const before = original.map((entry) => entry.player.id)
    sortLeaderboard(original, 'name', 'desc')

    expect(original.map((entry) => entry.player.id)).toEqual(before)
  })

  it('handles every offered sort key', () => {
    for (const key of SORT_KEYS) {
      expect(sortLeaderboard(ranked(), key, 'asc')).toHaveLength(3)
    }
  })
})
