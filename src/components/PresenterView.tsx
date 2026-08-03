import { useEffect } from 'react'
import { Trophy, Users, X } from 'lucide-react'
import type { RankedPlayer } from '../team/leaderboard'
import type { TeamParticipant, TeamStatus } from '../team/types'

interface PresenterViewProps {
  code: string
  joinAddress: string
  status: TeamStatus
  roster: TeamParticipant[]
  standings: RankedPlayer[]
  onClose: () => void
}

/**
 * The screen a room sees on the projector. Standings carry only place, name, turn
 * and revenue - the penalty maths stays on the facilitator's own console.
 */
export function PresenterView({
  code,
  joinAddress,
  status,
  roster,
  standings,
  onClose,
}: PresenterViewProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const players = roster.filter((member) => member.role === 'player')
  const showStandings = status !== 'waiting' && standings.length > 0
  // A trophy only means something if one person holds the place.
  const soleLeader = standings.filter((entry) => entry.rank === 1).length === 1

  return (
    <div className="presenter" role="dialog" aria-modal="true" aria-label="Presenter view">
      <button className="presenter-close" type="button" onClick={onClose}>
        <X size={20} aria-hidden="true" /> Close
      </button>

      {showStandings ? (
        <div className="presenter-body presenter-standings">
          <p className="presenter-kicker">
            {status === 'finished' ? 'Final standings' : 'Standings'}
            <span className="presenter-joincode">{joinAddress} &middot; {code}</span>
          </p>
          <ol>
            {standings.map((entry) => (
              <li key={entry.player.id} className={entry.rank === 1 && soleLeader ? 'presenter-leader' : undefined}>
                <span className="presenter-place">
                  {entry.rank === 1 && soleLeader
                    ? <Trophy size={30} role="img" aria-label="First place" />
                    : entry.rank}
                </span>
                <span className="presenter-name">{entry.player.name}</span>
                <span className="presenter-turn">Turn {entry.player.scoredThroughRound}</span>
                <strong className="presenter-revenue">${entry.player.revenue.toFixed(2)}</strong>
              </li>
            ))}
          </ol>
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
