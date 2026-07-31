import { CAR_MODELS, type GameState, type ModelValues } from './types'
import { getRoundSummary } from './engine'

const total = (values: ModelValues) =>
  CAR_MODELS.reduce((sum, model) => sum + values[model], 0)

const csvCell = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`

export function buildRunCsv(game: GameState): string {
  const summaries = [...game.history, getRoundSummary(game)]
  const rows = [
    ['Round', 'Revenue', 'Completed', 'WIP', 'Projected WIP penalty', 'Unused red', 'Unused yellow', 'Unused blue'],
    ...summaries.map((round) => [
      round.round + 1,
      round.revenue,
      total(round.completed),
      total(round.wip),
      round.projectedPenalty,
      round.unusedResources.red,
      round.unusedResources.yellow,
      round.unusedResources.blue,
    ]),
  ]
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}