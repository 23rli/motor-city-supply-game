import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Calculator, Check, Download, History, KeyRound, LoaderCircle, Package, Sparkles, UserMinus } from 'lucide-react'
import { RESOURCES } from '../game/types'
import {
  STALL_AFTER_MS,
  buildCohortCsv,
  cohortReferenceTime,
  summarizeCohort,
} from '../team/cohort'
import { buildSessionWorkbook } from '../team/sessionWorkbook'
import type { OptimalRunJob, TeamExport, TeamExportPlayer, TeamPlayerReport } from '../team/types'

const totalOf = (values: Record<string, number>) =>
  Object.values(values).reduce((sum, value) => sum + value, 0)

interface CohortBoardProps {
  players: TeamPlayerReport[]
  code: string
  finished: boolean
  endedAt: string | null
  onReadmit: (player: TeamPlayerReport) => void
  onRemove: (player: TeamPlayerReport) => void
  onExport: () => Promise<TeamExport>
  readmitted: { name: string; recoveryCode: string } | null
  onDismissReadmit: () => void
  optimalRun: OptimalRunJob | null
  onCalculateOptimal: () => void
  onViewReference: (player: TeamExportPlayer) => void
}

function OptimalRunCard({
  job,
  onCalculate,
  onView,
}: {
  job: OptimalRunJob | null
  onCalculate: () => void
  onView: (player: TeamExportPlayer) => void
}) {
  const player = job?.player
  const pending = job?.status === 'queued' || job?.status === 'running'
  if (!player) {
    return (
      <article className="cohort-card cohort-reference">
        <header>
          <div>
            <strong>Optimal Run</strong>
            <small className="cohort-reference-label">
              {job?.status === 'failed'
                ? 'Calculation unavailable'
                : pending
                  ? job.status === 'queued' ? 'Waiting for solver' : 'Calculating this setup'
                  : 'Reference simulation'}
            </small>
          </div>
          {pending
            ? <LoaderCircle className="optimal-spinner" size={18} aria-hidden="true" />
            : <Calculator size={18} aria-hidden="true" />}
        </header>
        <p className="cohort-reference-copy">
          {job?.status === 'failed'
            ? job.message ?? 'No legal reference run was produced. Try again.'
            : pending
              ? 'The solver runs in the background. You can keep preparing the class.'
              : 'Calculate a reference student from this exact schedule, economics, models, and scoring rounds.'}
        </p>
        <button
          className="button button-secondary cohort-action"
          type="button"
          disabled={pending}
          onClick={onCalculate}
        >
          {pending
            ? <LoaderCircle className="optimal-spinner" size={14} aria-hidden="true" />
            : <Calculator size={14} aria-hidden="true" />}
          {pending ? 'Calculating...' : job?.status === 'failed' ? 'Try again' : 'Calculate reference run'}
        </button>
      </article>
    )
  }

  return (
    <article className="cohort-card cohort-reference">
      <header>
        <div>
          <strong>{player.name}</strong>
          <small className="cohort-reference-label">
            {job?.status === 'optimal' ? 'Proven optimal simulation' : 'Best run found · not proven optimal'}
          </small>
        </div>
        <span className="cohort-round">R{player.currentRound}</span>
      </header>
      <dl>
        <div><dt>Revenue</dt><dd>${player.revenue.toFixed(2)}</dd></div>
        <div><dt>Shipped</dt><dd>{player.throughput}</dd></div>
        <div><dt>Score</dt><dd>${player.projectedScore.toFixed(2)}</dd></div>
      </dl>
      <p className="cohort-signals">
        <span><Sparkles size={12} aria-hidden="true" /> {player.history.length}-round engine replay</span>
        <span><Package size={12} aria-hidden="true" /> {totalOf(player.wip)} final WIP</span>
      </p>
      <button
        className="button button-secondary cohort-action"
        type="button"
        onClick={() => onView(player)}
      >
        <History size={14} aria-hidden="true" /> View round history
      </button>
    </article>
  )
}

export function CohortBoard({
  players,
  code,
  finished,
  endedAt,
  onReadmit,
  onRemove,
  onExport,
  readmitted,
  onDismissReadmit,
  optimalRun,
  onCalculateOptimal,
  onViewReference,
}: CohortBoardProps) {
  const [now, setNow] = useState(() => Date.now())
  const [confirming, setConfirming] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [workbookError, setWorkbookError] = useState<string | null>(null)
  const referenceTime = cohortReferenceTime(finished, endedAt, now)
  const summary = summarizeCohort(players, referenceTime)

  // Without its own tick, a board that goes quiet after this mounted would never be flagged.
  useEffect(() => {
    if (finished) return
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [finished])

  // A facilitator scans for trouble, so lead with the quiet boards and the ones furthest behind.
  const ordered = useMemo(
    () =>
      [...players].sort((left, right) => {
        const leftQuiet = referenceTime - Date.parse(left.lastSeenAt) > STALL_AFTER_MS
        const rightQuiet = referenceTime - Date.parse(right.lastSeenAt) > STALL_AFTER_MS
        if (leftQuiet !== rightQuiet) return leftQuiet ? -1 : 1
        return left.currentRound - right.currentRound
      }),
    [players, referenceTime],
  )

  const saveFile = (data: BlobPart, filename: string, type: string) => {
    const blob = new Blob([data], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    // The anchor has to be in the document, and the URL has to outlive the click.
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const download = () => {
    if (!finished) setNow(Date.now())
    saveFile(buildCohortCsv(players), `motor-city-${code}-cohort.csv`, 'text/csv;charset=utf-8')
  }

  const downloadWorkbook = async () => {
    setWorkbookError(null)
    setBuilding(true)
    try {
      const data = await onExport()
      saveFile(
        buildSessionWorkbook(data),
        `motor-city-${code}-session.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
    } catch {
      setWorkbookError('The workbook could not be built. The CSV export still works.')
    } finally {
      setBuilding(false)
    }
  }

  if (players.length === 0) {
    return (
      <section className="cohort" aria-labelledby="cohort-title">
        <div className="panel-heading">
          <div><p>Live cohort</p><h2 id="cohort-title">Factory floor</h2></div>
        </div>
        <div className="cohort-grid">
          <OptimalRunCard
            job={optimalRun}
            onCalculate={onCalculateOptimal}
            onView={onViewReference}
          />
        </div>
        <p className="cohort-empty">Player boards appear here once the session starts.</p>
      </section>
    )
  }

  return (
    <section className="cohort" aria-labelledby="cohort-title">
      <div className="panel-heading">
        <div><p>Live cohort</p><h2 id="cohort-title">Factory floor</h2></div>
        <div className="cohort-exports">
          <button
            className="button button-secondary"
            type="button"
            disabled={building}
            onClick={() => void downloadWorkbook()}
          >
            <Download size={16} aria-hidden="true" />
            {building ? 'Building...' : 'Excel workbook'}
          </button>
          <button className="button button-quiet" type="button" onClick={download}>
            <Download size={16} aria-hidden="true" /> CSV
          </button>
        </div>
      </div>

      {workbookError && <p className="form-error" role="alert">{workbookError}</p>}

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
        {finished
          ? <div><dt>Median score</dt><dd>${summary.score.median.toFixed(2)}</dd></div>
          : <div><dt>Median revenue</dt><dd>${summary.revenue.median.toFixed(2)}</dd></div>}
        <div><dt>Cars shipped</dt><dd>{summary.shipped}</dd></div>
        <div className={summary.stalled > 0 ? 'cohort-alert' : undefined}>
          <dt>Quiet boards</dt><dd>{summary.stalled}</dd>
        </div>
      </dl>

      <details className="stranded-panel">
        <summary>
          <Package size={15} aria-hidden="true" />
          Material nobody could use
          <em>{totalOf(summary.stranded)} across every board</em>
        </summary>
        <div className="stranded-body">
          {RESOURCES.map((resource) => (
            <span className={`stranded-chip material-${resource}`} key={resource}>
              <strong>{summary.stranded[resource]}</strong> {resource}
            </span>
          ))}
        </div>
      </details>

      <div className="cohort-grid">
        <OptimalRunCard
          job={optimalRun}
          onCalculate={onCalculateOptimal}
          onView={onViewReference}
        />
        {ordered.map((player) => {
          const quiet = referenceTime - Date.parse(player.lastSeenAt) > STALL_AFTER_MS
          const wip = totalOf(player.wip)
          return (
            <article className={`cohort-card${quiet ? ' card-quiet' : ''}`} key={player.id}>
              <header>
                <strong>{player.name}</strong>
                <span className="cohort-round">R{player.currentRound}</span>
              </header>

              <dl>
                <div><dt>Revenue</dt><dd>${player.revenue.toFixed(2)}</dd></div>
                <div><dt>Shipped</dt><dd>{totalOf(player.completed)}</dd></div>
                {/* Cars still on the floor are the penalty, so they stay hidden until the reveal. */}
                {finished && <div><dt>WIP</dt><dd>{wip}</dd></div>}
                {finished && <div><dt>Score</dt><dd>${player.projectedScore.toFixed(2)}</dd></div>}
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
