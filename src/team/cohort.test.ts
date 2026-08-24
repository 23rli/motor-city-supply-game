import { describe, expect, it } from 'vitest'
import {
  STALL_AFTER_MS,
  buildCohortCsv,
  cohortReferenceTime,
  summarizeCohort,
} from './cohort'
import type { TeamPlayerReport } from './types'

const NOW = Date.parse('2026-08-01T12:00:00.000Z')

const player = (
  name: string,
  overrides: Partial<TeamPlayerReport> = {},
): TeamPlayerReport => ({
  id: `id-${name}`,
  name,
  identifier: null,
  round: 4,
  stateVersion: 1,
  completed: { blue: 1, green: 0, red: 0, yellow: 0 },
  wip: { blue: 1, green: 1, red: 0, yellow: 0 },
  revenue: 3,
  projectedPenalty: 2.5,
  projectedScore: 0.5,
  lastSeenAt: new Date(NOW).toISOString(),
  scoredThroughRound: 5,
  penaltyMeasuredAtRound: 5,  peakWip: 0,
  averageWip: 0,
  throughput: 0,  currentRound: 5,
  stranded: { red: 4, yellow: 6, blue: 0 },
  paint: { occupancy: 1, curing: false, cured: 0 },
  ...overrides,
})

describe('cohort summary', () => {
  it('freezes activity comparisons at the recorded finish time', () => {
    const endedAt = '2026-08-01T12:00:00.000Z'
    expect(cohortReferenceTime(true, endedAt, NOW + 60_000)).toBe(NOW)
    expect(cohortReferenceTime(false, endedAt, NOW + 60_000)).toBe(NOW + 60_000)
  })

  it('reports an empty room without dividing by zero', () => {
    expect(summarizeCohort([], NOW)).toMatchObject({
      players: 0,
      stalled: 0,
      rounds: { low: 0, high: 0, median: 0 },
      score: { low: 0, high: 0, median: 0, mean: 0 },
      wip: { total: 0, median: 0 },
      shipped: 0,
      stranded: { red: 0, yellow: 0, blue: 0 },
    })
  })

  it('surfaces the constraint by totalling what nobody could use', () => {
    const summary = summarizeCohort(
      [
        player('Ada', { stranded: { red: 5, yellow: 7, blue: 0 } }),
        player('Bo', { stranded: { red: 3, yellow: 2, blue: 1 } }),
      ],
      NOW,
    )

    expect(summary.stranded).toEqual({ red: 8, yellow: 9, blue: 1 })
  })

  it('flags only players whose board has gone quiet', () => {
    const summary = summarizeCohort(
      [
        player('Ada'),
        player('Bo', {
          lastSeenAt: new Date(NOW - STALL_AFTER_MS - 1_000).toISOString(),
        }),
      ],
      NOW,
    )

    expect(summary.stalled).toBe(1)
  })

  it('spreads rounds and scores across the room', () => {
    const summary = summarizeCohort(
      [
        player('Ada', { currentRound: 2, projectedScore: 1 }),
        player('Bo', { currentRound: 6, projectedScore: 5 }),
        player('Cy', { currentRound: 4, projectedScore: 3 }),
      ],
      NOW,
    )

    expect(summary.rounds).toEqual({ low: 2, high: 6, median: 4 })
    expect(summary.score).toEqual({ low: 1, high: 5, median: 3, mean: 3 })
  })
})

describe('cohort export', () => {
  it('writes one row per player with a header', () => {
    const csv = buildCohortCsv([player('Ada'), player('Bo')])
    const lines = csv.split('\r\n')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('"Player"')
    expect(lines[1]).toContain('"Ada"')
    expect(lines[2]).toContain('"Bo"')
  })

  it('escapes a name that would otherwise break the file', () => {
    const csv = buildCohortCsv([player('Ada "Ace", Lovelace')])

    expect(csv).toContain('"Ada ""Ace"", Lovelace"')
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('carries the identifier so results can be matched to a real person', () => {
    const csv = buildCohortCsv([
      player('Ada', { identifier: 'alovelace@wustl.edu' }),
      player('Bo'),
    ])
    const lines = csv.split('\r\n')

    expect(lines[0]).toContain('"Identifier"')
    expect(lines[1]).toContain('"alovelace@wustl.edu"')
    // Nobody is forced to give one, and a blank must not shift the other columns.
    expect(lines[2].split(',')[1]).toBe('""')
  })

  it('neutralizes spreadsheet formulas in player-controlled fields', () => {
    const csv = buildCohortCsv([
      player('=HYPERLINK("https://example.test")', { identifier: ' +SUM(1,1)' }),
    ])

    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"')
    expect(csv).toContain('"\' +SUM(1,1)"')
  })
})
