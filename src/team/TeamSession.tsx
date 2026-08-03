import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Factory,
  Flag,
  KeyRound,
  Minus,
  MonitorPlay,
  Play,
  Radio,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react'
import MotorCityApp from '../MotorCityApp'
import { CohortBoard } from '../components/CohortBoard'
import { PresenterView } from '../components/PresenterView'
import { ApiClientError, teamApi } from './api'
import { podium, rankPlayers, rankSnapshot, sortLeaderboard, type SortDirection, type SortKey } from './leaderboard'
import { GAME_STAT_ROWS, summarizeGameStats } from './gameStats'
import type {
  PlayerCommand,
  TeamReport,
  TeamSessionSnapshot,
} from './types'

interface TeamSessionProps {
  recoveryCode: string | null
  resumed?: boolean
  initialSnapshot?: TeamSessionSnapshot | null
  onExit: () => void
  onInvalid: (reason?: string) => void
}

export function TeamSession({
  recoveryCode,
  resumed = false,
  initialSnapshot = null,
  onExit,
  onInvalid,
}: TeamSessionProps) {
  const [snapshot, setSnapshot] = useState<TeamSessionSnapshot | null>(initialSnapshot)
  const [report, setReport] = useState<TeamReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [penaltyRound, setPenaltyRound] = useState(1)
  const [endRound, setEndRound] = useState(1)
  const [connectionState, setConnectionState] = useState<
    'syncing' | 'synced' | 'offline'
  >('syncing')
  const [showResumed, setShowResumed] = useState(resumed)
  const [readmitted, setReadmitted] = useState<
    { name: string; recoveryCode: string } | null
  >(null)

  // Ranks from the previous poll, so the board can show which way each player just moved.
  const previousRanks = useRef<ReadonlyMap<string, number>>(new Map())
  const [sortKey, setSortKey] = useState<SortKey>('rank')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [copied, setCopied] = useState(false)
  const [ending, setEnding] = useState(false)
  const [presenting, setPresenting] = useState(false)
  // What a student should type into a browser, without the scheme or a trailing slash.
  const joinAddress = window.location.host + (window.location.pathname === '/' ? '' : window.location.pathname)
  const leaderboard = useMemo(
    () => rankPlayers(report?.players ?? [], previousRanks.current),
    [report],
  )
  const visibleRows = useMemo(
    () => sortLeaderboard(leaderboard, sortKey, sortDirection),
    [leaderboard, sortKey, sortDirection],
  )
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection(key === 'name' || key === 'rank' ? 'asc' : 'desc')
  }
  useEffect(() => {
    previousRanks.current = rankSnapshot(leaderboard)
  }, [leaderboard])
  const finished = snapshot?.game.status === 'finished'
  const gameStats = useMemo(
    () => summarizeGameStats(report?.players ?? []),
    [report],
  )

  useEffect(() => {
    if (!showResumed) return
    const timer = window.setTimeout(() => setShowResumed(false), 5_000)
    return () => window.clearTimeout(timer)
  }, [showResumed])

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
        onInvalid(caught.code.startsWith('SESSION_') ? caught.message : undefined)
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
      <>
        {showResumed && (
          <p className="resume-toast" role="status">
            Welcome back &mdash; your factory is exactly as you left it.
          </p>
        )}
        <MotorCityApp
          remote={{
            game: snapshot.state,
            sessionLabel: `Team ${snapshot.game.code} / ${connectionState}`,
            onCommand: sendCommand,
            onExit,
          }}
        />
      </>
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

  const readmitPlayer = async (player: { id: string; name: string }) => {
    setBusy(true)
    setError(null)
    try {
      const issued = await teamApi.readmitParticipant(snapshot.game.id, player.id)
      setReadmitted({ name: issued.name, recoveryCode: issued.recoveryCode })
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'A new recovery code could not be issued.',
      )
    } finally {
      setBusy(false)
    }
  }

  const removePlayer = async (player: { id: string; name: string }) => {
    setBusy(true)
    setError(null)
    try {
      await teamApi.removeParticipant(snapshot.game.id, player.id)
      await load()
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : `${player.name} could not be removed.`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="team-room">
      {presenting && (
        <PresenterView
          code={snapshot.game.code}
          joinAddress={joinAddress}
          status={snapshot.game.status}
          roster={snapshot.roster}
          standings={leaderboard}
          onClose={() => setPresenting(false)}
        />
      )}
      <header className="room-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><Factory size={22} /></span>
          <div><h1>Motor City</h1><p>{snapshot.participant.role} console</p></div>
        </div>
        <div className={`sync-state sync-${connectionState}`}><Radio size={14} aria-hidden="true" /><span>{connectionState}</span></div>
        <button className="button button-quiet" type="button" onClick={onExit}>
          <ArrowLeft size={17} aria-hidden="true" /> Back to menu
        </button>
      </header>

      <main className="room-main">
        <section className="room-code-band">
          <div className="room-code-main">
            <p>{snapshot.game.status === 'waiting' ? 'Lobby open' : snapshot.game.status === 'active' ? 'Production underway' : 'Run complete'}</p>
            <h2>{snapshot.game.code}</h2>
            {snapshot.participant.role === 'facilitator' && snapshot.game.status !== 'finished' && (
              <p className="room-code-directions">
                Students: go to <strong>{joinAddress}</strong> and enter this code.
              </p>
            )}
          </div>
          <div className="room-code-actions">
            {snapshot.participant.role === 'facilitator' && (
              <button
                className="button button-primary room-copy"
                type="button"
                onClick={() => setPresenting(true)}
              >
                <MonitorPlay size={17} aria-hidden="true" /> Present
              </button>
            )}
            <button
              className="button button-quiet room-copy"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(`${joinAddress} — code ${snapshot.game.code}`)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 2000)
              }}
            >
              <Clipboard size={17} aria-hidden="true" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className={`room-state state-${snapshot.game.status}`}><i /><span>{snapshot.game.status}</span></div>
        </section>

        {showResumed && (
          <p className="resume-toast resume-toast-inline" role="status">
            Welcome back &mdash; your session was restored.
          </p>
        )}

        {recoveryCode && (
          <details className="recovery-banner" aria-label="Session recovery code">
            <summary>
              <KeyRound size={15} aria-hidden="true" />
              <span>Recovery code</span>
              <em>keeps your seat if this device dies</em>
            </summary>
            <div className="recovery-body">
              <strong>{recoveryCode}</strong>
              <span>Use this with the join code and your name on another device.</span>
              <button
                className="icon-button"
                type="button"
                aria-label="Copy recovery code"
                onClick={() => void navigator.clipboard.writeText(recoveryCode)}
              >
                <Clipboard size={19} />
              </button>
            </div>
          </details>
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
                <dl className="session-details"><div><dt>Car models</dt><dd>{snapshot.game.config.enabledModels.length}</dd></div><div><dt>Players</dt><dd>{snapshot.roster.filter((member) => member.role === 'player').length}</dd></div></dl>
                {snapshot.game.status === 'waiting' && <button className="button button-primary control-action" type="button" disabled={busy} onClick={() => void runLifecycle('start')}><Play size={17} fill="currentColor" /> Start production</button>}
                {snapshot.game.status === 'active' && (
                  <>
                    <div className="end-settings">
                      <label>
                        <span>Score up to round</span>
                        <em>Revenue counts through this round</em>
                        <input
                          type="number"
                          min="1"
                          value={endRound}
                          onChange={(event) => setEndRound(Math.max(1, Number(event.target.value)))}
                        />
                      </label>
                      <label>
                        <span>Charge unfinished cars at round</span>
                        <em>Cars still on the floor cost money</em>
                        <input
                          type="number"
                          min="1"
                          value={penaltyRound}
                          onChange={(event) => setPenaltyRound(Math.max(1, Number(event.target.value)))}
                        />
                      </label>
                    </div>

                    {penaltyRound > endRound && (
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
                            disabled={busy || penaltyRound > endRound}
                            onClick={() => {
                              setEnding(false)
                              void runLifecycle('end')
                            }}
                          >
                            <Flag size={17} aria-hidden="true" /> Yes, end it
                          </button>
                          <button
                            className="button button-secondary control-action"
                            type="button"
                            onClick={() => setEnding(false)}
                          >
                            Keep playing
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="button button-danger control-action"
                        type="button"
                        disabled={busy || penaltyRound > endRound}
                        onClick={() => setEnding(true)}
                      >
                        <Flag size={17} aria-hidden="true" /> End production
                      </button>
                    )}
                  </>
                )}
                {snapshot.game.status === 'finished' && <div className="finished-state"><Check size={18} /><span>Final report locked</span></div>}
              </>
            ) : (
              <div className="player-session-note"><strong>{snapshot.participant.name}</strong><span>{snapshot.game.status === 'finished' ? 'Final report available' : 'Factory assigned'}</span></div>
            )}
          </section>
        </div>

        {snapshot.participant.role === 'facilitator' && (
          <CohortBoard
            players={report?.players ?? []}
            code={snapshot.game.code}
            finished={snapshot.game.status === 'finished'}
            onReadmit={(player) => void readmitPlayer(player)}
            onRemove={(player) => void removePlayer(player)}
            onExport={() => teamApi.getExport(snapshot.game.id)}
            readmitted={readmitted}
            onDismissReadmit={() => setReadmitted(null)}
          />
        )}

        {(snapshot.participant.role === 'facilitator' || snapshot.game.status === 'finished') && (
          <section className="leaderboard-panel" aria-labelledby="leaderboard-title">
            <div className="panel-heading">
              <div><p>Live standings</p><h2 id="leaderboard-title">Leaderboard</h2></div>
              {leaderboard.length > 1 && (
                <span className="leaderboard-spread">
                  {leaderboard[leaderboard.length - 1].behindLeader === 0
                    ? 'Dead level'
                    : `$${leaderboard[leaderboard.length - 1].behindLeader.toFixed(2)} spread`}
                </span>
              )}
            </div>

            {finished && leaderboard.length > 0 && (
              <ol className="podium" aria-label="Final places">
                {podium(leaderboard).map((entry) => (
                  <li key={entry.player.id} className={`podium-place podium-${entry.rank}`}>
                    <span className="podium-rank">
                      {entry.rank === 1 ? <Trophy size={16} aria-hidden="true" /> : entry.rank}
                    </span>
                    <span className="podium-name">{entry.player.name}</span>
                    <strong className="podium-score">${entry.player.projectedScore.toFixed(2)}</strong>
                  </li>
                ))}
              </ol>
            )}

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {([
                      ['rank', '#'],
                      ['name', 'Player'],
                      ['behind', 'Behind'],
                      ['round', 'Round'],
                      ['revenue', 'Revenue'],
                      ['penalty', 'WIP exposure'],
                      ['peakWip', 'Peak WIP'],
                      ['averageWip', 'Avg WIP'],
                      ['score', 'Score'],
                    ] as [SortKey, string][]).map(([key, label]) => (
                      <th
                        scope="col"
                        key={key}
                        aria-sort={
                          sortKey === key
                            ? sortDirection === 'asc' ? 'ascending' : 'descending'
                            : 'none'
                        }
                      >
                        <button
                          type="button"
                          className="column-sort"
                          onClick={() => toggleSort(key)}
                        >
                          {label}
                          {sortKey === key && (
                            <span aria-hidden="true">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!visibleRows.length ? (
                    <tr><td colSpan={9} className="empty-row">Player results will appear here.</td></tr>
                  ) : visibleRows.map((entry) => (
                    <tr key={entry.player.id} className={entry.rank === 1 ? 'leaderboard-leader' : undefined}>
                      <td>
                        <span className="leaderboard-rank">
                          {entry.rank}
                          {entry.movement === 'up' && (
                            <ChevronUp size={13} className="movement-up" aria-label="moved up" />
                          )}
                          {entry.movement === 'down' && (
                            <ChevronDown size={13} className="movement-down" aria-label="moved down" />
                          )}
                          {entry.movement === 'new' && (
                            <Sparkles size={12} className="movement-new" aria-label="new" />
                          )}
                          {entry.movement === 'level' && (
                            <Minus size={12} className="movement-level" aria-hidden="true" />
                          )}
                        </span>
                      </td>
                      <td>
                        {entry.player.name}
                        {entry.player.identifier && (
                          <span className="leaderboard-identifier">{entry.player.identifier}</span>
                        )}
                      </td>
                      <td>{entry.behindLeader === 0 ? '—' : `-$${entry.behindLeader.toFixed(2)}`}</td>
                      <td>{entry.player.scoredThroughRound}</td>
                      <td>${entry.player.revenue.toFixed(2)}</td>
                      <td>${entry.player.projectedPenalty.toFixed(2)}</td>
                      <td>{entry.player.peakWip}</td>
                      <td>{entry.player.averageWip}</td>
                      <td><strong>${entry.player.projectedScore.toFixed(2)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {finished && leaderboard.length > 0 && (
              <div className="game-stats">
                <h3>Cohort statistics</h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Measure</th>
                        <th scope="col">Lowest</th>
                        <th scope="col">Highest</th>
                        <th scope="col">Median</th>
                        <th scope="col">Mean</th>
                      </tr>
                    </thead>
                    <tbody>
                      {GAME_STAT_ROWS.map((row) => {
                        const spread = gameStats[row.key]
                        const show = (value: number) =>
                          row.money ? `$${value.toFixed(2)}` : Math.round(value * 100) / 100
                        return (
                          <tr key={row.key}>
                            <td>{row.label}</td>
                            <td>{show(spread.low)}</td>
                            <td>{show(spread.high)}</td>
                            <td>{show(spread.median)}</td>
                            <td>{show(spread.mean)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}