import { useEffect } from 'react'
import { Users, X } from 'lucide-react'
import type { TeamParticipant, TeamStatus } from '../team/types'

interface PresenterViewProps {
  code: string
  joinAddress: string
  status: TeamStatus
  roster: TeamParticipant[]
  rounds: { low: number; high: number } | null
  onClose: () => void
}

/**
 * The screen a room sees on the projector: how to join, and who is in.
 * Deliberately carries no scores, so nobody is ranked in front of the class.
 */
export function PresenterView({
  code,
  joinAddress,
  status,
  roster,
  rounds,
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

  return (
    <div className="presenter" role="dialog" aria-modal="true" aria-label="Presenter view">
      <button className="presenter-close" type="button" onClick={onClose}>
        <X size={20} aria-hidden="true" /> Close
      </button>

      <div className="presenter-body">
        {status === 'finished' ? (
          <>
            <p className="presenter-kicker">That&rsquo;s the run</p>
            <h1 className="presenter-headline">Production complete</h1>
            <p className="presenter-sub">{players.length} factories took part</p>
          </>
        ) : (
          <>
            <p className="presenter-kicker">Join the game</p>
            <p className="presenter-address">{joinAddress}</p>
            <h1 className="presenter-code">{code}</h1>
            <p className="presenter-sub">
              {status === 'waiting'
                ? 'Enter the code above, then pick a name'
                : `Round ${rounds ? (rounds.low === rounds.high ? rounds.low : `${rounds.low}\u2013${rounds.high}`) : 1} in progress`}
            </p>
          </>
        )}

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
    </div>
  )
}
