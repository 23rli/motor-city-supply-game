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

/** The finishing places worth calling out loud; ties mean this can be longer or shorter than three. */
export function podium(ranked: RankedPlayer[]) {
  return ranked.filter((entry) => entry.rank <= 3)
}
