import type { TeamPlayerReport } from './types'

/** Low / high / median / mean, the four rows the original game's Game Stats table reported. */
export interface Spread {
  low: number
  high: number
  median: number
  mean: number
}

const spreadOf = (values: number[]): Spread => {
  if (values.length === 0) return { low: 0, high: 0, median: 0, mean: 0 }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return {
    low: sorted[0],
    high: sorted[sorted.length - 1],
    median: sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  }
}

export interface GameStats {
  revenueBeforePenalty: Spread
  revenueAfterPenalty: Spread
  wipPenalty: Spread
  peakWip: Spread
  averageWip: Spread
  throughput: Spread
  round: Spread
}

export function summarizeGameStats(players: TeamPlayerReport[]): GameStats {
  return {
    revenueBeforePenalty: spreadOf(players.map((player) => player.revenue)),
    revenueAfterPenalty: spreadOf(players.map((player) => player.projectedScore)),
    wipPenalty: spreadOf(players.map((player) => player.projectedPenalty)),
    peakWip: spreadOf(players.map((player) => player.peakWip)),
    averageWip: spreadOf(players.map((player) => player.averageWip)),
    throughput: spreadOf(players.map((player) => player.throughput)),
    round: spreadOf(players.map((player) => player.scoredThroughRound)),
  }
}

export const GAME_STAT_ROWS = [
  { key: 'revenueBeforePenalty', label: 'Revenue before WIP penalty', money: true },
  { key: 'revenueAfterPenalty', label: 'Revenue after WIP penalty', money: true },
  { key: 'wipPenalty', label: 'WIP penalty', money: true },
  { key: 'peakWip', label: 'Peak WIP', money: false },
  { key: 'averageWip', label: 'Average WIP', money: false },
  { key: 'throughput', label: 'Cars shipped', money: false },
  { key: 'round', label: 'Round reached', money: false },
] as const satisfies readonly { key: keyof GameStats; label: string; money: boolean }[]
