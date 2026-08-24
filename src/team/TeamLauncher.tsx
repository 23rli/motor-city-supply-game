import { useState, type FormEvent } from 'react'
import {
  ArrowRight,
  Factory,
  LogOut,
  Play,
  RotateCw,
  Users,
} from 'lucide-react'
import blueCar from '../assets/cars/blue.webp'
import greenCar from '../assets/cars/green.webp'
import redCar from '../assets/cars/red.webp'
import yellowCar from '../assets/cars/yellow.webp'
import { RunSetupFields } from '../components/RunSetupFields'
import { DEFAULT_REVENUE, DEFAULT_WIP_PENALTY } from '../game/engine'
import { CAR_MODELS, type CarModel, type ResourcePlan } from '../game/types'
import { ApiClientError, teamApi } from './api'
import type { TeamCredentials } from './types'

interface TeamLauncherProps {
  savedTeamSession: boolean
  signedOutReason?: string | null
  onSolo: () => void
  onTeam: (credentials: TeamCredentials) => void
  onResume: () => void
  onForget: () => void
}

export function TeamLauncher({
  savedTeamSession,
  signedOutReason,
  onSolo,
  onTeam,
  onResume,
  onForget,
}: TeamLauncherProps) {
  const [teamAction, setTeamAction] = useState<'join' | 'rejoin' | 'create'>('join')
  const [facilitatorName, setFacilitatorName] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [models, setModels] = useState<CarModel[]>([...CAR_MODELS])
  const [resourcePlan, setResourcePlan] = useState<ResourcePlan>('classic')
  const [revenue, setRevenue] = useState({ ...DEFAULT_REVENUE })
  const [wipPenalty, setWipPenalty] = useState({ ...DEFAULT_WIP_PENALTY })
  const [notes, setNotes] = useState('')
  const [reuseSetup, setReuseSetup] = useState(false)
  const [previousCode, setPreviousCode] = useState('')
  const [previousRecoveryCode, setPreviousRecoveryCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<TeamCredentials>) => {
    setBusy(true)
    setError(null)
    try {
      const credentials = await action()
      onTeam(credentials)
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : 'The team session could not be opened.',
      )
    } finally {
      setBusy(false)
    }
  }

  const handleTeamSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (teamAction === 'join') {
      void run(() => teamApi.joinGame({
        code: code.trim().toUpperCase(),
        playerName,
        identifier: identifier.trim() || undefined,
      }))
      return
    }
    if (teamAction === 'rejoin') {
      void run(() => teamApi.rejoinGame({
        code: code.trim().toUpperCase(),
        playerName,
        recoveryCode,
      }))
      return
    }
    void run(() => teamApi.createGame({
      facilitatorName,
      enabledModels: models,
      resourcePlan,
      revenue,
      wipPenalty,
      notes,
      reuse: reuseSetup
        ? {
            code: previousCode.trim().toUpperCase(),
            recoveryCode: previousRecoveryCode,
          }
        : undefined,
    }))
  }

  return (
    <div className="launcher-shell">
      <header className="launcher-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><Factory size={22} /></span>
          <div><h1>Motor City</h1><p>Supply game</p></div>
        </div>
        <span className="launcher-status">Factory console / ready</span>
      </header>

      <main className="launcher-main">
        <section className="launcher-visual" aria-labelledby="launcher-title">
          <div className="launcher-copy">
            <p>Production simulation</p>
            <h2 id="launcher-title">Choose your shift</h2>
          </div>
          <div className="vehicle-line" aria-hidden="true">
            {[blueCar, greenCar, redCar, yellowCar].map((image, index) => (
              <div key={image}><span>{String(index + 1).padStart(2, '0')}</span><img src={image} alt="" /></div>
            ))}
          </div>
          <button className="solo-launch" type="button" onClick={onSolo}>
            <span><Play size={20} fill="currentColor" aria-hidden="true" /></span>
            <div><strong>Solo production run</strong><small>Play immediately on this device</small></div>
            <ArrowRight size={20} aria-hidden="true" />
          </button>
        </section>

        <section className="team-console" aria-labelledby="team-console-title">
          <div className="console-heading">
            <span><Users size={20} aria-hidden="true" /></span>
            <div><p>Shared schedule</p><h2 id="team-console-title">Team session</h2></div>
          </div>

          <div className="segmented-control" aria-label="Team action">
            <button type="button" aria-pressed={teamAction === 'join'} onClick={() => setTeamAction('join')}>Join</button>
            <button type="button" aria-pressed={teamAction === 'rejoin'} onClick={() => setTeamAction('rejoin')}>Rejoin</button>
            <button type="button" aria-pressed={teamAction === 'create'} onClick={() => setTeamAction('create')}>Facilitate</button>
          </div>

          <form className="team-form" onSubmit={handleTeamSubmit}>
            {teamAction !== 'create' ? (
              <>
                <label><span>Join code</span><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={6} placeholder="ABC234" autoComplete="off" required /></label>
                <label><span>{teamAction === 'rejoin' ? 'Participant name' : 'Player name'}</span><input value={playerName} onChange={(event) => setPlayerName(event.target.value)} maxLength={80} placeholder="Your name" required /></label>
                {teamAction === 'join' && (
                  <label>
                    <span>Student ID or email <em>optional</em></span>
                    <input
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      maxLength={120}
                      placeholder="So your instructor can match your results"
                      autoComplete="off"
                    />
                  </label>
                )}
                {teamAction === 'rejoin' && (
                  <label><span>Recovery code</span><input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} maxLength={128} placeholder="Saved recovery code" required /></label>
                )}
              </>
            ) : (
              <>
                <label><span>Facilitator name</span><input value={facilitatorName} onChange={(event) => setFacilitatorName(event.target.value)} maxLength={80} placeholder="Your name" required /></label>
                <label className="reuse-toggle">
                  <input type="checkbox" checked={reuseSetup} onChange={(event) => setReuseSetup(event.target.checked)} />
                  <span>Reuse a previous facilitator setup</span>
                </label>
                {reuseSetup ? (
                  <div className="reuse-fields">
                    <label><span>Previous join code</span><input value={previousCode} onChange={(event) => setPreviousCode(event.target.value.toUpperCase())} maxLength={6} placeholder="ABC234" required /></label>
                    <label><span>Previous facilitator recovery code</span><input value={previousRecoveryCode} onChange={(event) => setPreviousRecoveryCode(event.target.value)} maxLength={128} required /></label>
                  </div>
                ) : (
                  <RunSetupFields
                    models={models}
                    resourcePlan={resourcePlan}
                    revenue={revenue}
                    wipPenalty={wipPenalty}
                    onModelsChange={setModels}
                    onResourcePlanChange={setResourcePlan}
                    onRevenueChange={setRevenue}
                    onWipPenaltyChange={setWipPenalty}
                  />
                )}
                <label><span>Run notes <em>optional</em></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2_000} rows={3} /></label>
              </>
            )}

            {signedOutReason && !error && (
              <p className="form-notice" role="status">{signedOutReason}</p>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}

            <button className="button button-primary team-submit" type="submit" disabled={busy || (teamAction === 'create' && !reuseSetup && models.length === 0)}>
              {busy ? 'Connecting...' : teamAction === 'join' ? 'Join session' : teamAction === 'rejoin' ? 'Rejoin session' : 'Create session'}
              {!busy && <ArrowRight size={17} aria-hidden="true" />}
            </button>
          </form>

          {savedTeamSession && (
            <div className="saved-session-actions">
              <button className="resume-session" type="button" onClick={onResume}>
                <RotateCw size={16} aria-hidden="true" /> Resume previous team session
              </button>
              <button className="forget-session" type="button" onClick={onForget}>
                <LogOut size={15} aria-hidden="true" /> Forget
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}