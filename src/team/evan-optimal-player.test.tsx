import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CohortBoard } from '../components/CohortBoard'
import { PlayerRoundHistory } from '../components/PlayerRoundHistory'
import { EVAN_RESOURCE_SCHEDULE } from '../game/engine'
import { EVAN_OPTIMAL_PLAYER } from './evan-optimal-player.generated'

describe('Optimal Run reference student', () => {
  it('contains the complete engine-replayed student history', () => {
    expect(EVAN_OPTIMAL_PLAYER).toMatchObject({
      name: 'Optimal Run',
      scoredThroughRound: 25,
      revenue: 82,
      projectedPenalty: 0,
      projectedScore: 82,
      throughput: 28,
      completed: { blue: 24, green: 0, red: 4, yellow: 0 },
      wip: { blue: 0, green: 0, red: 0, yellow: 0 },
    })
    expect(EVAN_OPTIMAL_PLAYER.history).toHaveLength(25)
    expect(EVAN_OPTIMAL_PLAYER.history.map((round) => round.round)).toEqual(
      Array.from({ length: 25 }, (_, round) => round),
    )
    expect(EVAN_OPTIMAL_PLAYER.history.map((round) => round.issuedResources)).toEqual(
      EVAN_RESOURCE_SCHEDULE,
    )
  })

  it('renders through the same round-history view as a real student', () => {
    const markup = renderToStaticMarkup(
      <PlayerRoundHistory player={EVAN_OPTIMAL_PLAYER} />,
    )

    expect(markup).toContain('Round 25')
    expect(markup).toContain('$82.00')
    expect(markup).toContain('Page 1 of 3 / 25 rounds')
    expect(markup).toContain('Issued R/Y/B')
    expect(markup).toContain('Exchanged R/Y/B')
  })

  it('appears as a reference student even before players join', () => {
    const markup = renderToStaticMarkup(
      <CohortBoard
        players={[]}
        code="ABC234"
        finished={false}
        endedAt={null}
        onReadmit={vi.fn()}
        onRemove={vi.fn()}
        onExport={vi.fn()}
        readmitted={null}
        onDismissReadmit={vi.fn()}
        optimalRun={{
          id: 'exact-evan-cache',
          status: 'optimal',
          player: EVAN_OPTIMAL_PLAYER,
        }}
        onCalculateOptimal={vi.fn()}
        onViewReference={vi.fn()}
      />,
    )

    expect(markup).toContain('Optimal Run')
    expect(markup).toContain('Proven optimal simulation')
    expect(markup).toContain('View round history')
    expect(markup).toContain('$82.00')
  })

  it('offers to calculate a reference for a setup without a cached run', () => {
    const markup = renderToStaticMarkup(
      <CohortBoard
        players={[]}
        code="ABC234"
        finished={false}
        endedAt={null}
        onReadmit={vi.fn()}
        onRemove={vi.fn()}
        onExport={vi.fn()}
        readmitted={null}
        onDismissReadmit={vi.fn()}
        optimalRun={null}
        onCalculateOptimal={vi.fn()}
        onViewReference={vi.fn()}
      />,
    )

    expect(markup).toContain('Calculate reference run')
    expect(markup).toContain('this exact schedule, economics, models, and scoring rounds')
  })

  it('announces background calculation progress without moving focus', () => {
    const markup = renderToStaticMarkup(
      <CohortBoard
        players={[]}
        code="ABC234"
        finished={false}
        endedAt={null}
        onReadmit={vi.fn()}
        onRemove={vi.fn()}
        onExport={vi.fn()}
        readmitted={null}
        onDismissReadmit={vi.fn()}
        optimalRun={{ id: 'queued-run', status: 'queued' }}
        onCalculateOptimal={vi.fn()}
        onViewReference={vi.fn()}
      />,
    )

    expect(markup).toContain('Waiting for solver')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-atomic="true"')
    expect(markup).toContain('disabled=""')
  })

  it('labels a time-limited result as not proven optimal', () => {
    const markup = renderToStaticMarkup(
      <CohortBoard
        players={[]}
        code="ABC234"
        finished={false}
        endedAt={null}
        onReadmit={vi.fn()}
        onRemove={vi.fn()}
        onExport={vi.fn()}
        readmitted={null}
        onDismissReadmit={vi.fn()}
        optimalRun={{
          id: 'best-found',
          status: 'feasible',
          player: { ...EVAN_OPTIMAL_PLAYER, name: 'Best Run Found' },
        }}
        onCalculateOptimal={vi.fn()}
        onViewReference={vi.fn()}
      />,
    )

    expect(markup).toContain('Best Run Found')
    expect(markup).toContain('Best run found · not proven optimal')
    expect(markup).not.toContain('Proven optimal simulation')
  })
})