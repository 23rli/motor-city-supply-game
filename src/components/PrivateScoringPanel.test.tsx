import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { EVAN_OPTIMAL_BENCHMARK } from '../game/evan-benchmark'
import { PrivateScoringPanel } from './PrivateScoringPanel'

const renderPanel = (status: 'waiting' | 'active' | 'finished') =>
  renderToStaticMarkup(
    <PrivateScoringPanel
      status={status}
      plannedPenaltyRound={10}
      endRound={10}
      penaltyRound={10}
      busy={false}
      ending={false}
      benchmark={EVAN_OPTIMAL_BENCHMARK}
      onEndRoundChange={vi.fn()}
      onPenaltyRoundChange={vi.fn()}
      onRequestEnd={vi.fn()}
      onCancelEnd={vi.fn()}
      onConfirmEnd={vi.fn()}
    />,
  )

describe('private scoring panel', () => {
  it('keeps the configured WIP round behind a closed disclosure', () => {
    const markup = renderPanel('waiting')
    const summaryEnd = markup.indexOf('</summary>')

    expect(markup).toContain('<details class="private-scoring">')
    expect(markup).not.toContain('<details class="private-scoring" open="">')
    expect(markup.indexOf('WIP penalty round')).toBeGreaterThan(summaryEnd)
    expect(markup).toContain('WIP penalty is configured; expand to review')
  })

  it('keeps active end controls inside the same private disclosure', () => {
    const markup = renderPanel('active')
    const summaryEnd = markup.indexOf('</summary>')

    expect(markup.indexOf('Score up to round')).toBeGreaterThan(summaryEnd)
    expect(markup.indexOf('End production')).toBeGreaterThan(summaryEnd)
  })

  it('keeps the exact v1 optimal result private too', () => {
    const markup = renderPanel('waiting')
    const summaryEnd = markup.indexOf('</summary>')

    expect(markup.indexOf('Exact v1 optimal result')).toBeGreaterThan(summaryEnd)
    expect(markup.indexOf('$81.00')).toBeGreaterThan(summaryEnd)
    expect(markup).toContain('28 cars shipped')
  })
})