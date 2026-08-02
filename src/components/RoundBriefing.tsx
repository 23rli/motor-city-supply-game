import { ArrowRight, Package, TrendingDown, TrendingUp } from 'lucide-react'
import { RESOURCES, type GameState, type RoundSummary } from '../game/types'

interface RoundBriefingProps {
  game: GameState
  previous: RoundSummary | null
  onDismiss: () => void
}

/** The beat between rounds: what last round produced, and what you have to work with now. */
export function RoundBriefing({ game, previous, onDismiss }: RoundBriefingProps) {
  const shipped = previous
    ? Object.values(previous.completed).reduce((total, value) => total + value, 0)
    : 0
  const wip = previous
    ? Object.values(previous.wip).reduce((total, value) => total + value, 0)
    : 0
  const stranded = previous
    ? RESOURCES.reduce((total, resource) => total + previous.unusedResources[resource], 0)
    : 0

  return (
    <div className="briefing">
      <p className="briefing-eyebrow">Materials delivered</p>
      <div className="briefing-materials">
        {RESOURCES.map((resource) => (
          <div className={`briefing-material material-${resource}`} key={resource}>
            <strong>{game.resources[resource]}</strong>
            <span>{resource}</span>
          </div>
        ))}
      </div>

      {previous && (
        <>
          <dl className="briefing-recap">
            <div>
              <dt><Package size={14} aria-hidden="true" /> Shipped so far</dt>
              <dd>{shipped}</dd>
            </div>
            <div>
              <dt><TrendingUp size={14} aria-hidden="true" /> Revenue</dt>
              <dd>${previous.revenue.toFixed(2)}</dd>
            </div>
            <div>
              <dt><TrendingDown size={14} aria-hidden="true" /> WIP exposure</dt>
              <dd className="briefing-penalty">
                {wip} car{wip === 1 ? '' : 's'} / ${previous.projectedPenalty.toFixed(2)}
              </dd>
            </div>
          </dl>

          <div className="briefing-stranded">
            <p>
              Left unused last round
              <span>{stranded === 0 ? 'Nothing stranded' : 'Material you paid for and could not use'}</span>
            </p>
            <div>
              {RESOURCES.map((resource) => (
                <span className={`stranded-chip material-${resource}`} key={resource}>
                  <strong>{previous.unusedResources[resource]}</strong>
                  {resource}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      <button className="button button-primary briefing-action" type="button" onClick={onDismiss}>
        Start round {game.round + 1} <ArrowRight size={17} aria-hidden="true" />
      </button>
    </div>
  )
}
