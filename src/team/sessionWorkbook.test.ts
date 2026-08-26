import { describe, expect, it } from 'vitest'
import { buildSessionWorkbook } from './sessionWorkbook'
import type { RoundSummary } from '../game/types'
import type { TeamExport, TeamExportPlayer } from './types'

const models = { blue: 0, green: 0, red: 0, yellow: 0 }
const pool = { red: 0, yellow: 0, blue: 0 }

const round = (index: number): RoundSummary => ({
  round: index,
  completed: { ...models, green: index },
  revenue: index * 100,
  wip: { ...models, green: 2 },
  projectedPenalty: index,
  unusedResources: { ...pool, red: 1 },
  stations: {
    planning: { ...models },
    manufacturing: { ...models, green: 1 },
    assembly: { ...models },
    quality: { ...models, green: 1 },
    paint: { ...models },
    dry: { ...models },
  },
  issuedResources: { ...pool, yellow: 4 },
  convertedResources: { ...pool, blue: 2 },
})

const player = (name: string, history: RoundSummary[]): TeamExportPlayer => ({
  id: `id-${name}`,
  name,
  identifier: `${name}@example.edu`,
  round: history.length,
  stateVersion: 1,
  completed: { ...models, green: 3 },
  wip: { ...models, green: 2 },
  revenue: 300,
  projectedPenalty: 20,
  projectedScore: 280,
  lastSeenAt: '2026-08-02T10:00:00.000Z',
  scoredThroughRound: history.length,
  penaltyMeasuredAtRound: history.length,
  peakWip: 5,
  averageWip: 2.5,
  throughput: 3,
  currentRound: history.length,
  stranded: { ...pool },
  paint: { occupancy: 0, curing: false, cured: 0 },
  history,
})

const data = (players: TeamExportPlayer[]): TeamExport => ({
  game: {
    id: 'game',
    code: 'ABC234',
    status: 'finished',
    config: {
      enabledModels: ['green'],
      resourcePlan: 'evan',
      resourceSchedule: [
        { red: 8, yellow: 6, blue: 2 },
        { red: 7, yellow: 4, blue: 3 },
      ],
      revenue: { blue: 3, green: 2, red: 2.5, yellow: 2.5 },
      wipPenalty: { blue: 1.5, green: 1, red: 1.25, yellow: 1.25 },
      notes: 'Evening cohort',
      timer: {
        enabled: true,
        segments: [
          { startRound: 1, endRound: 5, durationSeconds: 600 },
          { startRound: 6, endRound: 10, durationSeconds: 300 },
        ],
      },
    },
    createdAt: '2026-08-02T08:00:00.000Z',
    startedAt: '2026-08-02T08:05:00.000Z',
    endedAt: '2026-08-02T10:00:00.000Z',
    penaltyRound: 8,
    endRound: 10,
  },
  players,
})

const decoder = new TextDecoder()
const when = new Date('2026-08-02T10:00:00Z')

describe('session workbook', () => {
  it('carries game details, an overview, cohort stats and one sheet per player', () => {
    const bytes = buildSessionWorkbook(
      data([player('Ada', [round(0), round(1)]), player('Bo', [round(0)])]),
      when,
    )
    const body = decoder.decode(bytes)

    expect(body).toContain('Game Details')
    expect(body).toContain('Player Overview')
    expect(body).toContain('Game Stats')
    expect(body).toContain('<sheet name="Ada"')
    expect(body).toContain('<sheet name="Bo"')
    expect(body).toContain('xl/worksheets/sheet5.xml')
  })

  it('records the setup, economics, notes, cutoffs, and exact resource schedule', () => {
    const body = decoder.decode(
      buildSessionWorkbook(data([player('Ada', [round(0)])]), when),
    )

    for (const value of [
      'Resource plan',
      'evan',
      'Evening cohort',
      'Scored through round',
      'WIP measured at round',
      'WIP rate',
      'Resource round',
      'Round timer',
      'R1-5: 10 min; R6-10: 5 min',
    ]) {
      expect(body).toContain(value)
    }
    expect(body).toContain('<v>8</v>')
    expect(body).toContain('<v>6</v>')
  })

  it('writes the per-station breakdown the original reported', () => {
    const body = decoder.decode(
      buildSessionWorkbook(data([player('Ada', [round(0)])]), when),
    )

    for (const heading of [
      'Manufacturing green',
      'Quality green',
      'Drying green',
      'Issued yellow',
      'Exchanged blue',
      'Unused red',
    ]) {
      expect(body).toContain(heading)
    }
  })

  it('keeps peak and average WIP on the overview', () => {
    const body = decoder.decode(
      buildSessionWorkbook(data([player('Ada', [round(0)])]), when),
    )

    expect(body).toContain('Peak WIP')
    expect(body).toContain('Average WIP')
    expect(body).toContain('<v>2.5</v>')
  })

  it('survives two players sharing a name without producing a broken workbook', () => {
    const body = decoder.decode(
      buildSessionWorkbook(
        data([player('Sam', [round(0)]), player('Sam', [round(0)])]),
        when,
      ),
    )

    expect(body).toContain('<sheet name="Sam"')
    expect(body).toContain('Sam (2)')
  })

  it('still produces a workbook when nobody has played a round', () => {
    const bytes = buildSessionWorkbook(data([player('Ada', [])]), when)
    expect(bytes.length).toBeGreaterThan(0)
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4B, 0x03, 0x04])
  })

  it('produces a workbook even with no players at all', () => {
    const bytes = buildSessionWorkbook(data([]), when)
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4B, 0x03, 0x04])
  })
})
