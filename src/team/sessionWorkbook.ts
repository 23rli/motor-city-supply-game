import { CAR_MODELS, RESOURCES, ROUND_STATIONS } from '../game/types'
import { GAME_STAT_ROWS, summarizeGameStats } from './gameStats'
import { buildWorkbook, type Sheet } from './xlsx'
import type { TeamExport } from './types'

const total = (values: Record<string, number>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0)

const STATION_LABELS: Record<string, string> = {
  planning: 'Waiting',
  manufacturing: 'Manufacturing',
  assembly: 'Assembly',
  quality: 'Quality',
  paint: 'Paint',
  dry: 'Drying',
}

/** Mirrors the sheets the original game exported: an overview, the cohort stats, then each player. */
export function buildSessionWorkbook(data: TeamExport, now = new Date()) {
  const overview: Sheet = {
    name: 'Player Overview',
    rows: [
      [
        'Player', 'Identifier', 'Scored through round', 'WIP measured at round',
        'Revenue', 'WIP penalty', 'Score', 'Cars shipped', 'Peak WIP', 'Average WIP',
        ...CAR_MODELS.map((model) => `Shipped ${model}`),
        ...CAR_MODELS.map((model) => `WIP ${model}`),
        'Last seen',
      ],
      ...data.players.map((player) => [
        player.name,
        player.identifier ?? '',
        player.scoredThroughRound,
        player.penaltyMeasuredAtRound,
        player.revenue,
        player.projectedPenalty,
        player.projectedScore,
        total(player.completed),
        player.peakWip,
        player.averageWip,
        ...CAR_MODELS.map((model) => player.completed[model]),
        ...CAR_MODELS.map((model) => player.wip[model]),
        player.lastSeenAt,
      ]),
    ],
  }

  const stats = summarizeGameStats(data.players)
  const gameStats: Sheet = {
    name: 'Game Stats',
    rows: [
      ['Measure', 'Lowest', 'Highest', 'Median', 'Mean'],
      ...GAME_STAT_ROWS.map((row) => {
        const spread = stats[row.key]
        return [row.label, spread.low, spread.high, spread.median, spread.mean]
      }),
    ],
  }

  const perPlayer: Sheet[] = data.players.map((player) => ({
    name: player.name,
    rows: [
      [
        'Round',
        ...ROUND_STATIONS.flatMap((station) =>
          CAR_MODELS.map((model) => `${STATION_LABELS[station]} ${model}`),
        ),
        'WIP',
        ...CAR_MODELS.map((model) => `Shipped ${model}`),
        'Revenue',
        'WIP penalty',
        ...RESOURCES.map((resource) => `Issued ${resource}`),
        ...RESOURCES.map((resource) => `Exchanged ${resource}`),
        ...RESOURCES.map((resource) => `Unused ${resource}`),
      ],
      ...player.history.map((round) => [
        round.round + 1,
        ...ROUND_STATIONS.flatMap((station) =>
          CAR_MODELS.map((model) => round.stations[station][model]),
        ),
        total(round.wip),
        ...CAR_MODELS.map((model) => round.completed[model]),
        round.revenue,
        round.projectedPenalty,
        ...RESOURCES.map((resource) => round.issuedResources[resource]),
        ...RESOURCES.map((resource) => round.convertedResources[resource]),
        ...RESOURCES.map((resource) => round.unusedResources[resource]),
      ]),
    ],
  }))

  return buildWorkbook([overview, gameStats, ...perPlayer], now)
}
