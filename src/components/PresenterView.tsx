import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Trophy, Users, X } from 'lucide-react'
import type { RankedPlayer } from '../team/leaderboard'
import type { TeamParticipant, TeamStatus } from '../team/types'
import { useDialogFocus } from './useDialogFocus'

interface PresenterViewProps {
  code: string
  joinAddress: string
  status: TeamStatus
  roster: TeamParticipant[]
  /** Ordered by revenue alone - what the room sees for the whole game. */
  standings: RankedPlayer[]
  /** Ordered by revenue minus the WIP penalty. Only once the run has ended. */
  finalStandings: RankedPlayer[] | null
  onClose: () => void
}

type Phase = 'revenue' | 'penalty' | 'final'

const PENALTY_BEAT_MS = 2200

/**
 * The screen a room sees on the projector. For the whole game it shows revenue only, so the
 * WIP penalty lands as a surprise: the facilitator triggers it, every board is charged for the
 * cars still sitting on it, and the places rearrange in front of the class.
 */
export function PresenterView({
  code,
  joinAddress,
  status,
  roster,
  standings,
  finalStandings,
  onClose,
}: PresenterViewProps) {
  const [phase, setPhase] = useState<Phase>('revenue')
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose)

  // Ending the run does not itself give the result away; the facilitator still presses reveal.
  useEffect(() => {
    if (!finalStandings) setPhase('revenue')
  }, [finalStandings])

  useEffect(() => {
    if (phase !== 'penalty') return
    const timer = window.setTimeout(() => setPhase('final'), PENALTY_BEAT_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  const shown = phase === 'final' && finalStandings ? finalStandings : standings
  const places = useMemo(
    () => new Map(shown.map((entry, index) => [entry.player.id, { entry, index }])),
    [shown],
  )
  const before = useMemo(
    () => new Map(standings.map((entry, index) => [entry.player.id, index])),
    [standings],
  )
  // The DOM order never changes, so a place change animates instead of the rows jumping.
  const rows = useMemo(
    () => [...standings].sort((left, right) => left.player.id.localeCompare(right.player.id)),
    [standings],
  )

  const players = roster.filter((member) => member.role === 'player')
  const showStandings = status !== 'waiting' && standings.length > 0
  // A trophy only means something if one person holds the place.
  const soleLeader = shown.filter((entry) => entry.rank === 1).length === 1

  const kicker = phase === 'final'
    ? 'Final standings'
    : finalStandings
      ? 'Before the unfinished cars are charged for'
      : 'Standings'

  return (
    <div className="presenter" role="dialog" aria-modal="true" aria-label="Presenter view" tabIndex={-1} ref={dialogRef}>
      <button className="presenter-close" type="button" onClick={onClose}>
        <X size={20} aria-hidden="true" /> Close
      </button>

      {showStandings ? (
        <div className="presenter-body presenter-standings">
          <p className="presenter-kicker">
            {kicker}
            <span className="presenter-joincode">{joinAddress} &middot; {code}</span>
          </p>
          <ol style={{ height: `calc(var(--presenter-row) * ${rows.length})` }}>
            {rows.map((row) => {
              const place = places.get(row.player.id)
              if (!place) return null
              const { entry, index } = place
              const first = entry.rank === 1 && soleLeader
              const moved = phase === 'final' ? (before.get(row.player.id) ?? index) - index : 0
              return (
                <li
                  key={row.player.id}
                  className={first ? 'presenter-leader' : undefined}
                  // The DOM order is fixed so rows can animate, so the real place is declared here.
                  aria-posinset={index + 1}
                  aria-setsize={rows.length}
                  style={{ transform: `translateY(calc(var(--presenter-row) * ${index}))` }}
                >
                  <span className="presenter-place">
                    {first
                      ? <Trophy size={30} role="img" aria-label="First place" />
                      : entry.rank}
                  </span>
                  <span className="presenter-name">{entry.player.name}</span>
                  {moved !== 0 && (
                    <span className={`presenter-moved ${moved > 0 ? 'up' : 'down'}`}>
                      {moved > 0
                        ? <ChevronUp size={24} role="img" aria-label={`up ${moved}`} />
                        : <ChevronDown size={24} role="img" aria-label={`down ${-moved}`} />}
                      {Math.abs(moved)}
                    </span>
                  )}
                  <span className="presenter-turn">Turn {entry.player.scoredThroughRound}</span>
                  {phase !== 'revenue' && entry.player.projectedPenalty > 0 && (
                    <span className="presenter-penalty">
                      &minus;${entry.player.projectedPenalty.toFixed(2)}
                    </span>
                  )}
                  <strong className="presenter-revenue">
                    ${(phase === 'final' ? entry.player.projectedScore : entry.player.revenue).toFixed(2)}
                  </strong>
                </li>
              )
            })}
          </ol>

          {finalStandings && (
            <div className="presenter-reveal">
              {phase === 'revenue' ? (
                <button className="button button-primary" type="button" onClick={() => setPhase('penalty')}>
                  Charge the unfinished cars
                </button>
              ) : phase === 'penalty' ? (
                <p className="presenter-counting" role="status">
                  Counting the cars left on the floor&hellip;
                </p>
              ) : (
                <button className="button button-quiet" type="button" onClick={() => setPhase('revenue')}>
                  Show it again
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="presenter-body">
          <p className="presenter-kicker">Join the game</p>
          <p className="presenter-address">{joinAddress}</p>
          <h1 className="presenter-code">{code}</h1>
          <p className="presenter-sub">Enter the code above, then pick a name</p>

          <div className="presenter-roster">
            <p><Users size={22} aria-hidden="true" /> {players.length} joined</p>
            {players.length > 0 && (
              <ul>
                {players.map((member) => (
                  <li key={member.id}>{member.name}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
