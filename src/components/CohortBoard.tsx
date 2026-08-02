import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Download, KeyRound, Package, Sparkles, UserMinus } from 'lucide-react'
import { RESOURCES } from '../game/types'
import { STALL_AFTER_MS, buildCohortCsv, summarizeCohort } from '../team/cohort'
import type { TeamPlayerReport } from '../team/types'

const totalOf = (values: Record<string, number>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0)

interface CohortBoardProps {
  players: TeamPlayerReport[]
  code: string
  finished: boolean
  onReadmit: (player: TeamPlayerReport) => void
  onRemove: (player: TeamPlayerReport) => void
  readmitted: { name: string; recoveryCode: string } | null
  onDismissReadmit: () => void
}

export function CohortBoard({
  players,
  code,
  finished,
  onReadmit,
  onRemove,
  readmitted,
  onDismissReadmit,
}: CohortBoardProps) {
  const [now, setNow] = useState(() => Date.now())
  const [confirming, setConfirming] = useState<string | null>(null)
  const summary = summarizeCohort(players, now)

  // Without its own tick, a board that goes quiet after this mounted would never be flagged.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  // A facilitator scans for trouble, so lead with the quiet boards and the ones furthest behind.
  const ordered = useMemo(
    () =>
      [...players].sort((left, right) => {
        const leftQuiet = now - Date.parse(left.lastSeenAt) > STALL_AFTER_MS
        const rightQuiet = now - Date.parse(right.lastSeenAt) > STALL_AFTER_MS
        if (leftQuiet !== rightQuiet) return leftQuiet ? -1 : 1
        return left.currentRound - right.currentRound
      }),
    [players, now],
  )

  const download = () => {
    setNow(Date.now())
    const blob = new Blob([buildCohortCsv(players)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `motor-city-${code}-cohort.csv`
    // The anchor has to be in the document, and the URL has to outlive the click.
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  if (players.length === 0) {
    return (
      <section className="cohort" aria-labelledby="cohort-title">
        <div className="panel-heading">
          <div><p>Live cohort</p><h2 id="cohort-title">Factory floor</h2></div>
        </div>
        <p className="cohort-empty">Player boards appear here once the session starts.</p>
      </section>
    )
  }

  return (
    <section className="cohort" aria-labelledby="cohort-title">
      <div className="panel-heading">
        <div><p>Live cohort</p><h2 id="cohort-title">Factory floor</h2></div>
        <button className="button button-secondary" type="button" onClick={download}>
          <Download size={16} aria-hidden="true" /> Export CSV
        </button>
      </div>

      {readmitted && (
        <div className="readmit-banner" role="alert">
          <KeyRound size={18} aria-hidden="true" />
          <div>
            <p>Read this to {readmitted.name}</p>
            <strong>{readmitted.recoveryCode}</strong>
            <span>They pick Rejoin, enter code {code}, their name, and this.</span>
          </div>
          <button className="button button-quiet" type="button" onClick={onDismissReadmit}>
            Done
          </button>
        </div>
      )}

      <dl className="cohort-stats">
        <div><dt>Players</dt><dd>{summary.players}</dd></div>
        <div><dt>Rounds</dt><dd>{summary.rounds.low}&ndash;{summary.rounds.high}</dd></div>
        <div><dt>Median score</dt><dd>${summary.score.median.toFixed(2)}</dd></div>
        <div><dt>Cars shipped</dt><dd>{summary.shipped}</dd></div>
        <div className={summary.stalled > 0 ? 'cohort-alert' : undefined}>
          <dt>Quiet boards</dt><dd>{summary.stalled}</dd>
        </div>
      </dl>

      <div className="stranded-panel">
        <p>
          Material nobody could use
          <span>Totalled across every board right now</span>
        </p>
        <div>
          {RESOURCES.map((resource) => (
            <span className={`stranded-chip material-${resource}`} key={resource}>
              <strong>{summary.stranded[resource]}</strong> {resource}
            </span>
          ))}
        </div>
      </div>

      <div className="cohort-grid">
        {ordered.map((player) => {
          const quiet = now - Date.parse(player.lastSeenAt) > STALL_AFTER_MS
          const wip = totalOf(player.wip)
          return (
            <article className={`cohort-card${quiet ? ' card-quiet' : ''}`} key={player.id}>
              <header>
                <strong>{player.name}</strong>
                <span className="cohort-round">R{player.currentRound}</span>
              </header>

              <dl>
                <div><dt>Score</dt><dd>${player.projectedScore.toFixed(2)}</dd></div>
                <div><dt>Shipped</dt><dd>{totalOf(player.completed)}</dd></div>
                <div><dt>WIP</dt><dd>{wip}</dd></div>
              </dl>

              <p className="cohort-signals">
                <span className={player.paint.curing ? 'signal-curing' : ''}>
                  <Sparkles size={12} aria-hidden="true" />
                  Paint {player.paint.occupancy}/3{player.paint.curing ? ' curing' : ''}
                </span>
                <span>
                  <Package size={12} aria-hidden="true" />
                  {totalOf(player.stranded)} unused
                </span>
                {quiet ? (
                  <span className="signal-quiet">
                    <AlertTriangle size={12} aria-hidden="true" /> No activity
                  </span>
                ) : (
                  <span className="cohort-live">
                    <Check size={12} aria-hidden="true" /> Active
                  </span>
                )}
              </p>

              {/* A student says their laptop died the moment it happens, not three minutes later. */}
              <button
                className="button button-secondary cohort-action"
                type="button"
                disabled={finished}
                onClick={() => onReadmit(player)}
              >
                <KeyRound size={14} aria-hidden="true" /> New code for {player.name}
              </button>

              {/* Two steps, because Kahoot facilitators report kicking the wrong student by accident. */}
              {confirming === player.id ? (
                <span className="cohort-confirm">
                  <button
                    className="button button-danger cohort-action"
                    type="button"
                    disabled={finished}
                    onClick={() => {
                      setConfirming(null)
                      onRemove(player)
                    }}
                  >
                    <UserMinus size={14} aria-hidden="true" /> Remove {player.name}
                  </button>
                  <button
                    className="button button-secondary cohort-action"
                    type="button"
                    onClick={() => setConfirming(null)}
                  >
                    Keep them
                  </button>
                </span>
              ) : (
                <button
                  className="button button-quiet cohort-action"
                  type="button"
                  disabled={finished}
                  onClick={() => setConfirming(player.id)}
                >
                  <UserMinus size={14} aria-hidden="true" /> Remove
                </button>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
