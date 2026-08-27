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
      revenue: 81,
      projectedPenalty: 0,
      projectedScore: 81,
      throughput: 28,
      completed: { blue: 24, green: 2, red: 2, yellow: 0 },
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
    expect(markup).toContain('$81.00')
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
        referencePlayer={EVAN_OPTIMAL_PLAYER}
        onViewReference={vi.fn()}
      />,
    )

    expect(markup).toContain('Optimal Run')
    expect(markup).toContain('Verified v1 simulation')
    expect(markup).toContain('View round history')
    expect(markup).toContain('$81.00')
  })
})