import { getPaintBoothStatus, getRoundSummary } from '../src/game/engine'
import type { GameState, RoundSummary } from '../src/game/types'

export interface ReportSettings {
  penaltyRound: number | null
  endRound: number | null
}

const summaryAtOrBefore = (
  summaries: RoundSummary[],
  oneBasedRound: number | null,
) => {
  if (oneBasedRound === null) return summaries.at(-1)!
  return [...summaries]
    .reverse()
    .find((summary) => summary.round + 1 <= oneBasedRound)
    ?? summaries[0]
}

const totalOf = (values: Record<string, number>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0)

export function calculatePlayerReport(
  state: GameState,
  settings: ReportSettings,
) {
  const summaries = [...state.history, getRoundSummary(state)]
  const endSummary = summaryAtOrBefore(summaries, settings.endRound)
  const penaltySummary = summaryAtOrBefore(summaries, settings.penaltyRound)
  const booth = getPaintBoothStatus(state)

  // The original report carried these, and they only mean anything across the whole run.
  const scored = summaries.filter((summary) => summary.round <= endSummary.round)
  const wipPerRound = scored.map((summary) => totalOf(summary.wip))
  const peakWip = wipPerRound.length ? Math.max(...wipPerRound) : 0
  const averageWip = wipPerRound.length
    ? wipPerRound.reduce((sum, value) => sum + value, 0) / wipPerRound.length
    : 0

  return {
    round: endSummary.round,
    completed: endSummary.completed,
    wip: penaltySummary.wip,
    revenue: endSummary.revenue,
    projectedPenalty: penaltySummary.projectedPenalty,
    projectedScore: endSummary.revenue - penaltySummary.projectedPenalty,
    scoredThroughRound: endSummary.round + 1,
    penaltyMeasuredAtRound: penaltySummary.round + 1,
    peakWip,
    averageWip: Math.round(averageWip * 1000) / 1000,
    throughput: totalOf(endSummary.completed),
    // Live signals, always read from the player's current board rather than the scored round.
    currentRound: state.round + 1,
    stranded: { ...state.resources },
    paint: {
      occupancy: booth.occupancy,
      curing: booth.curing,
      cured: booth.cured,
    },
  }
}