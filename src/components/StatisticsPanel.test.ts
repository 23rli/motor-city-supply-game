import { describe, expect, it } from 'vitest'
import type { RoundSummary } from '../game/types'
import { pageStatistics } from './reportPagination'

const history = Array.from({ length: 30 }, (_, round) => ({ round }) as RoundSummary)

describe('solo statistics pagination', () => {
  it('preserves chronological order in twelve-row pages', () => {
    const page = pageStatistics(history, 1, 12)
    expect(page.pageCount).toBe(3)
    expect(page.rows.map((round) => round.round)).toEqual([
      12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ])
  })

  it('supports the original 24 and 48 row sizes', () => {
    expect(pageStatistics(history, 0, 24).rows).toHaveLength(24)
    expect(pageStatistics(history, 0, 48).rows).toHaveLength(30)
  })
})