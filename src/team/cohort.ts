import { CAR_MODELS, RESOURCES, type ModelValues, type ResourcePool } from '../game/types'
import type { TeamPlayerReport } from './types'

/** A player is flagged for the facilitator once their board has been quiet this long. */
export const STALL_AFTER_MS = 3 * 60 * 1000

const total = (values: ModelValues) =>
  CAR_MODELS.reduce((sum, model) => sum + values[model], 0)

const median = (values: number[]) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

const mean = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length

export interface CohortSummary {
  players: number
  stalled: number
  rounds: { low: number; high: number; median: number }
  score: { low: number; high: number; median: number; mean: number }
  wip: { total: number; median: number }
  shipped: number
  stranded: ResourcePool
}

export function summarizeCohort(
  players: TeamPlayerReport[],
  now = Date.now(),
): CohortSummary {
  const rounds = players.map((player) => player.currentRound)
  const scores = players.map((player) => player.projectedScore)
  const wips = players.map((player) => total(player.wip))

  return {
    players: players.length,
    stalled: players.filter(
      (player) => now - Date.parse(player.lastSeenAt) > STALL_AFTER_MS,
    ).length,
    rounds: {
      low: rounds.length ? Math.min(...rounds) : 0,
      high: rounds.length ? Math.max(...rounds) : 0,
      median: median(rounds),
    },
    score: {
      low: scores.length ? Math.min(...scores) : 0,
      high: scores.length ? Math.max(...scores) : 0,
      median: median(scores),
      mean: mean(scores),
    },
    wip: { total: wips.reduce((sum, value) => sum + value, 0), median: median(wips) },
    shipped: players.reduce((sum, player) => sum + total(player.completed), 0),
    // The teaching payoff: the constraint material sits near zero while the others pile up.
    stranded: RESOURCES.reduce<ResourcePool>(
      (pool, resource) => ({
        ...pool,
        [resource]: players.reduce(
          (sum, player) => sum + player.stranded[resource],
          0,
        ),
      }),
      { red: 0, yellow: 0, blue: 0 },
    ),
  }
}

const csvCell = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`

export function buildCohortCsv(players: TeamPlayerReport[]): string {
  const rows = [
    [
      'Player',
      'Identifier',
      'Current round',
      'Scored through round',
      'WIP measured at round',
      'Revenue',
      'WIP penalty',
      'Score',
      'Cars shipped',
      'WIP cars',
      ...CAR_MODELS.map((model) => `Shipped ${model}`),
      ...CAR_MODELS.map((model) => `WIP ${model}`),
      'Unused red',
      'Unused yellow',
      'Unused blue',
      'Paint occupancy',
      'Last seen',
    ],
    ...players.map((player) => [
      player.name,
      player.identifier ?? '',
      player.currentRound,
      player.scoredThroughRound,
      player.penaltyMeasuredAtRound,
      player.revenue.toFixed(2),
      player.projectedPenalty.toFixed(2),
      player.projectedScore.toFixed(2),
      total(player.completed),
      total(player.wip),
      ...CAR_MODELS.map((model) => player.completed[model]),
      ...CAR_MODELS.map((model) => player.wip[model]),
      player.stranded.red,
      player.stranded.yellow,
      player.stranded.blue,
      player.paint.occupancy,
      player.lastSeenAt,
    ]),
  ]
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}
