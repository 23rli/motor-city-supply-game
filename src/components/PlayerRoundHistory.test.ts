import { describe, expect, it } from 'vitest'
import type { RoundSummary } from '../game/types'
import { HISTORY_PAGE_SIZE, pageRoundHistory } from './reportPagination'

const rounds = Array.from(
  { length: 25 },
  (_, round) => ({ round }) as RoundSummary,
)

describe('player round history pagination', () => {
  it('shows the newest twelve rounds first', () => {
    const page = pageRoundHistory(rounds, 0)
    expect(page.pageCount).toBe(3)
    expect(page.rows).toHaveLength(HISTORY_PAGE_SIZE)
    expect(page.rows.map((round) => round.round)).toEqual([
      24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13,
    ])
  })

  it('clamps a stale page after history shrinks', () => {
    const page = pageRoundHistory(rounds.slice(0, 3), 8)
    expect(page.page).toBe(0)
    expect(page.rows.map((round) => round.round)).toEqual([2, 1, 0])
  })
})