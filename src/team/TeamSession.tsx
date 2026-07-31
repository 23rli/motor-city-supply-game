import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Clipboard,
  Factory,
  Flag,
  Play,
  Radio,
  Users,
} from 'lucide-react'
import MotorCityApp from '../MotorCityApp'
import { ApiClientError, teamApi } from './api'
import type {
  PlayerCommand,
  TeamReport,
  TeamSessionSnapshot,
} from './types'

interface TeamSessionProps {
  recoveryCode: string | null
  onExit: () => void
  onInvalid: () => void
}

export function TeamSession({
  recoveryCode,
  onExit,
  onInvalid,
}: TeamSessionProps) {
  const [snapshot, setSnapshot] = useState<TeamSessionSnapshot | null>(null)
  const [report, setReport] = useState<TeamReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [penaltyRound, setPenaltyRound] = useState(1)
  const [endRound, setEndRound] = useState(1)
  const [connectionState, setConnectionState] = useState<
    'syncing' | 'synced' | 'offline'
  >('syncing')

  const snapshotFingerprint = (value: TeamSessionSnapshot) => JSON.stringify({
    game: value.game,
    participant: {
      id: value.participant.id,
      role: value.participant.role,
      stateVersion: value.participant.stateVersion,
    },
    roster: value.roster.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      stateVersion: member.stateVersion,
    })),
    state: value.state,
    stateVersion: value.stateVersion,
  })

  const load = useCallback(async () => {
    try {
      const nextSnapshot = await teamApi.getSession()
      setSnapshot((current) =>
        current && snapshotFingerprint(current) === snapshotFingerprint(nextSnapshot)
          ? current
          : nextSnapshot,
      )
      setError(null)
      setConnectionState('synced')
      if (nextSnapshot.participant.role === 'facilitator' || nextSnapshot.game.status === 'finished') {
        const nextReport = await teamApi.getReport(nextSnapshot.game.id)
        setReport((current) =>
          current && JSON.stringify(current) === JSON.stringify(nextReport)
            ? current
            : nextReport,
        )
      }
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 401) {
        onInvalid()
        return false
      }
      setError(caught instanceof ApiClientError ? caught.message : 'The session could not be synchronized.')
      setConnectionState('offline')
      return false
    }
    return true
  }, [onInvalid])

  useEffect(() => {
    let active = true
    let timeout: number | undefined
    let delay = 2_000
    const poll = async () => {
      if (!active) return
      const synchronized = await load()
      delay = synchronized ? 2_000 : Math.min(delay * 2, 60_000)
      if (active) timeout = window.setTimeout(() => void poll(), delay)
    }
    void poll()
    return () => {
      active = false
      if (timeout) window.clearTimeout(timeout)
    }
  }, [load])

  if (!snapshot) {
    return (
      <div className="session-loading">
        <Factory size={30} aria-hidden="true" />
        <strong>{error ?? 'Opening factory session...'}</strong>
        {error && <button className="button button-secondary" type="button" onClick={onExit}>Back</button>}
      </div>
    )
  }

  const sendCommand = async (command: PlayerCommand) => {
    try {
      const result = await teamApi.sendCommand(
        snapshot.stateVersion,
        command,
      )
      setSnapshot((current) => current ? {
        ...current,
        state: result.state,
        stateVersion: result.stateVersion,
        participant: {
          ...current.participant,
          stateVersion: result.stateVersion,
        },
      } : current)
      return null
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === 'STALE_STATE') {
        await load()
      }
      if (caught instanceof ApiClientError && caught.code === 'NETWORK_ERROR') {
        setConnectionState('offline')
      }
      return caught instanceof ApiClientError
        ? caught.message
        : 'The command could not be synchronized.'
    }
  }

  if (
    snapshot.participant.role === 'player'
    && snapshot.game.status === 'active'
    && snapshot.state
  ) {
    return (
      <MotorCityApp
        remote={{
          game: snapshot.state,
          sessionLabel: `Team ${snapshot.game.code} / ${connectionState}`,
          onCommand: sendCommand,
          onExit,
        }}
      />
    )
  }

  const runLifecycle = async (action: 'start' | 'end') => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'start') {
        await teamApi.startGame(snapshot.game.id)
      } else {
        const result = await teamApi.endGame(snapshot.game.id, {
          penaltyRound,
          endRound,
        })
        setReport(result.report)
      }
      await load()
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'The game state could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="team-room">
      <header className="room-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><Factory size={22} /></span>
          <div><h1>Motor City</h1><p>{snapshot.participant.role} console</p></div>
        </div>
        <div className={`sync-state sync-${connectionState}`}><Radio size={14} aria-hidden="true" /><span>{connectionState}</span></div>
        <button className="button button-quiet" type="button" onClick={onExit}><ArrowLeft size={17} /> Leave</button>
      </header>

      <main className="room-main">
        <section className="room-code-band">
          <div><p>{snapshot.game.status === 'waiting' ? 'Lobby open' : snapshot.game.status === 'active' ? 'Production underway' : 'Run complete'}</p><h2>{snapshot.game.code}</h2></div>
          <button className="icon-button room-copy" type="button" title="Copy join code" aria-label="Copy join code" onClick={() => void navigator.clipboard.writeText(snapshot.game.code)}><Clipboard size={19} /></button>
          <div className={`room-state state-${snapshot.game.status}`}><i /><span>{snapshot.game.status}</span></div>
        </section>

        {recoveryCode && (
          <section className="recovery-banner" aria-label="Session recovery code">
            <div>
              <p>Save once</p>
              <strong>{recoveryCode}</strong>
              <span>Use this with the join code and your name on another device.</span>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Copy recovery code"
              aria-label="Copy recovery code"
              onClick={() => void navigator.clipboard.writeText(recoveryCode)}
            >
              <Clipboard size={19} />
            </button>
          </section>
        )}

        {snapshot.participant.role === 'player' && snapshot.game.status === 'waiting' && (
          <section className="waiting-band">
            <span><Users size={24} aria-hidden="true" /></span>
            <div><h2>Waiting for the facilitator</h2><p>Your factory will open automatically when the session starts.</p></div>
          </section>
        )}

        {error && <p className="form-error room-error" role="alert">{error}</p>}

        <div className="room-grid">
          <section className="roster-panel" aria-labelledby="roster-title">
            <div className="panel-heading"><div><p>Live lobby</p><h2 id="roster-title">Roster</h2></div><strong>{snapshot.roster.filter((member) => member.role === 'player').length}</strong></div>
            <div className="roster-list">
              {snapshot.roster.map((member) => (
                <div key={member.id} className="roster-row">
                  <span className="roster-avatar">{member.name.slice(0, 2).toUpperCase()}</span>
                  <div><strong>{member.name}</strong><small>{member.role}</small></div>
                  <Check size={16} aria-label="Connected" />
                </div>
              ))}
            </div>
          </section>

          <section className="control-panel" aria-labelledby="control-title">
            <div className="panel-heading"><div><p>Session</p><h2 id="control-title">Control</h2></div></div>
            {snapshot.participant.role === 'facilitator' ? (
              <>
                <dl className="session-details"><div><dt>Models</dt><dd>{snapshot.game.config.enabledModels.length}</dd></div><div><dt>Created</dt><dd>{new Date(snapshot.game.createdAt).toLocaleDateString()}</dd></div></dl>
                {snapshot.game.status === 'waiting' && <button className="button button-primary control-action" type="button" disabled={busy} onClick={() => void runLifecycle('start')}><Play size={17} fill="currentColor" /> Start production</button>}
                {snapshot.game.status === 'active' && (
                  <>
                    <div className="end-settings">
                      <label>
                        <span>WIP round</span>
                        <input
                          type="number"
                          min="1"
                          value={penaltyRound}
                          onChange={(event) => setPenaltyRound(Math.max(1, Number(event.target.value)))}
                        />
                      </label>
                      <label>
                        <span>Report cutoff</span>
                        <input
                          type="number"
                          min="1"
                          value={endRound}
                          onChange={(event) => setEndRound(Math.max(1, Number(event.target.value)))}
                        />
                      </label>
                    </div>
                    <button
                      className="button button-danger control-action"
                      type="button"
                      disabled={busy || penaltyRound > endRound}
                      onClick={() => void runLifecycle('end')}
                    >
                      <Flag size={17} /> End production
                    </button>
                  </>
                )}
                {snapshot.game.status === 'finished' && <div className="finished-state"><Check size={18} /><span>Final report locked</span></div>}
              </>
            ) : (
              <div className="player-session-note"><strong>{snapshot.participant.name}</strong><span>{snapshot.game.status === 'finished' ? 'Final report available' : 'Factory assigned'}</span></div>
            )}
          </section>
        </div>

        {(snapshot.participant.role === 'facilitator' || snapshot.game.status === 'finished') && (
          <section className="leaderboard-panel" aria-labelledby="leaderboard-title">
            <div className="panel-heading"><div><p>Performance</p><h2 id="leaderboard-title">Teams</h2></div></div>
            <div className="table-scroll">
              <table><thead><tr><th>Player</th><th>Cutoff</th><th>WIP round</th><th>Revenue</th><th>WIP exposure</th><th>Projected score</th></tr></thead><tbody>
                {!report?.players.length ? <tr><td colSpan={6} className="empty-row">Player results will appear here.</td></tr> : report.players.map((player) => (
                  <tr key={player.id}><td>{player.name}</td><td>{player.scoredThroughRound}</td><td>{player.penaltyMeasuredAtRound}</td><td>${player.revenue.toFixed(2)}</td><td>${player.projectedPenalty.toFixed(2)}</td><td><strong>${player.projectedScore.toFixed(2)}</strong></td></tr>
                ))}
              </tbody></table>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}