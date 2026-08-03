import type { TeamPlayerReport } from './types'

export type Movement = 'new' | 'up' | 'down' | 'level'

export interface RankedPlayer {
  player: TeamPlayerReport
  rank: number
  movement: Movement
  /** How far behind the leader, so a facilitator can see whether the field is close. */
  behindLeader: number
}

/** Rank by score, ties sharing a place. Name breaks ties so the order never jitters between polls. */
export function rankPlayers(
  players: TeamPlayerReport[],
  previousRanks?: ReadonlyMap<string, number>,
): RankedPlayer[] {
  const sorted = [...players].sort((left, right) =>
    right.projectedScore - left.projectedScore
    || left.name.localeCompare(right.name, 'en-US')
    || left.id.localeCompare(right.id),
  )

  const leadingScore = sorted[0]?.projectedScore ?? 0
  const ranked: RankedPlayer[] = []

  sorted.forEach((player, index) => {
    const previousEntry = ranked[index - 1]
    // Standard competition ranking: equal scores share a place and the next one skips.
    const rank = previousEntry && previousEntry.player.projectedScore === player.projectedScore
      ? previousEntry.rank
      : index + 1
    const was = previousRanks?.get(player.id)
    const movement: Movement = was === undefined
      ? 'new'
      : was > rank
        ? 'up'
        : was < rank
          ? 'down'
          : 'level'
    ranked.push({
      player,
      rank,
      movement,
      behindLeader: leadingScore - player.projectedScore,
    })
  })

  return ranked
}

export const rankSnapshot = (ranked: RankedPlayer[]) =>
  new Map(ranked.map((entry) => [entry.player.id, entry.rank]))

export const SORT_KEYS = [
  'rank',
  'name',
  'behind',
  'round',
  'revenue',
  'penalty',
  'score',
  'peakWip',
  'averageWip',
] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDirection = 'asc' | 'desc'

const sortValue = (entry: RankedPlayer, key: SortKey): number | string => {
  switch (key) {
    case 'rank': return entry.rank
    case 'name': return entry.player.name.toLocaleLowerCase('en-US')
    case 'behind': return entry.behindLeader
    case 'round': return entry.player.scoredThroughRound
    case 'revenue': return entry.player.revenue
    case 'penalty': return entry.player.projectedPenalty
    case 'score': return entry.player.projectedScore
    case 'peakWip': return entry.player.peakWip
    case 'averageWip': return entry.player.averageWip
  }
}

/** Reorders rows for reading. Rank is always by score, so it stays put whatever the sort. */
export function sortLeaderboard(
  entries: RankedPlayer[],
  key: SortKey,
  direction: SortDirection,
): RankedPlayer[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...entries].sort((left, right) => {
    const a = sortValue(left, key)
    const b = sortValue(right, key)
    const compared = typeof a === 'string' && typeof b === 'string'
      ? a.localeCompare(b, 'en-US')
      : Number(a) - Number(b)
    // Name breaks every tie so the order is identical between polls.
    return compared * factor
      || left.player.name.localeCompare(right.player.name, 'en-US')
      || left.player.id.localeCompare(right.player.id)
  })
}

/** The finishing places worth calling out loud; ties mean this can be longer or shorter than three. */
export function podium(ranked: RankedPlayer[]) {
  return ranked.filter((entry) => entry.rank <= 3)
}
