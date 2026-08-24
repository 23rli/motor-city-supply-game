import type { RoundSummary } from '../game/types'

export const HISTORY_PAGE_SIZE = 12

export function pageRoundHistory(
  history: RoundSummary[],
  page: number,
  pageSize = HISTORY_PAGE_SIZE,
) {
  const ordered = [...history].sort((left, right) => right.round - left.round)
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize))
  const safePage = Math.min(Math.max(page, 0), pageCount - 1)
  return {
    page: safePage,
    pageCount,
    rows: ordered.slice(safePage * pageSize, (safePage + 1) * pageSize),
    total: ordered.length,
  }
}

export function pageStatistics(
  history: RoundSummary[],
  page: number,
  pageSize: number,
) {
  const pageCount = Math.max(1, Math.ceil(history.length / pageSize))
  const safePage = Math.min(Math.max(page, 0), pageCount - 1)
  return {
    page: safePage,
    pageCount,
    rows: history.slice(safePage * pageSize, (safePage + 1) * pageSize),
  }
}