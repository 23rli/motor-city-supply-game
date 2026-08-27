import { Flag, LockKeyhole } from 'lucide-react'
import type { EvanOptimalBenchmark } from '../game/evan-benchmark'
import type { TeamStatus } from '../team/types'

interface PrivateScoringPanelProps {
  status: TeamStatus
  plannedPenaltyRound: number | null
  endRound: number
  penaltyRound: number
  busy: boolean
  ending: boolean
  benchmark: EvanOptimalBenchmark | null
  onEndRoundChange: (round: number) => void
  onPenaltyRoundChange: (round: number) => void
  onRequestEnd: () => void
  onCancelEnd: () => void
  onConfirmEnd: () => void
}

export function PrivateScoringPanel({
  status,
  plannedPenaltyRound,
  endRound,
  penaltyRound,
  busy,
  ending,
  benchmark,
  onEndRoundChange,
  onPenaltyRoundChange,
  onRequestEnd,
  onCancelEnd,
  onConfirmEnd,
}: PrivateScoringPanelProps) {
  const invalid = penaltyRound > endRound

  return (
    <details className="private-scoring">
      <summary>
        <LockKeyhole size={17} aria-hidden="true" />
        <span>
          <strong>Private scoring</strong>
          <small>WIP penalty is configured; expand to review</small>
        </span>
      </summary>
      <div className="private-scoring-body">
        <p className="private-scoring-note">
          Collapse this section before students can see the admin screen.
        </p>
        {benchmark && (
          <section className="private-scoring-benchmark" aria-label="Exact v1 optimal result">
            <span>Exact v1 optimal result</span>
            <strong>${benchmark.score.toFixed(2)}</strong>
            <p>
              {benchmark.throughput} cars shipped: {benchmark.completed.blue} blue,
              {' '}{benchmark.completed.green} green, and {benchmark.completed.red} red.
            </p>
            <small>
              ${benchmark.revenue.toFixed(2)} revenue · ${benchmark.wipPenalty.toFixed(2)} WIP penalty
            </small>
          </section>
        )}
        {status !== 'active' && (
          <dl className="private-scoring-values">
            <div><dt>WIP penalty round</dt><dd>{plannedPenaltyRound ?? 'Not set'}</dd></div>
          </dl>
        )}
        {status === 'active' && (
          <>
            <div className="end-settings">
              <label>
                <span>Score up to round</span>
                <em>Revenue counts through this round</em>
                <input
                  type="number"
                  min="1"
                  value={endRound}
                  onChange={(event) => onEndRoundChange(Math.max(1, Number(event.target.value)))}
                />
              </label>
              <label>
                <span>WIP penalty round</span>
                <em>Unfinished cars are measured here</em>
                <input
                  type="number"
                  min="1"
                  value={penaltyRound}
                  onChange={(event) => onPenaltyRoundChange(Math.max(1, Number(event.target.value)))}
                />
              </label>
            </div>

            {invalid && (
              <p className="form-error" role="alert">
                The penalty round cannot be later than the round you score up to.
              </p>
            )}

            {ending ? (
              <div className="end-confirm">
                <p>
                  End the run for everyone? Scores lock at round {endRound} and players
                  can no longer move cars. You can still download the results afterwards.
                </p>
                <div className="end-confirm-actions">
                  <button
                    className="button button-danger control-action"
                    type="button"
                    disabled={busy || invalid}
                    onClick={onConfirmEnd}
                  >
                    <Flag size={17} aria-hidden="true" /> Yes, end it
                  </button>
                  <button
                    className="button button-secondary control-action"
                    type="button"
                    onClick={onCancelEnd}
                  >
                    Keep playing
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="button button-danger control-action"
                type="button"
                disabled={busy || invalid}
                onClick={onRequestEnd}
              >
                <Flag size={17} aria-hidden="true" /> End production
              </button>
            )}
          </>
        )}
      </div>
    </details>
  )
}