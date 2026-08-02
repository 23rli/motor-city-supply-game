import { useCallback, useEffect, useState } from 'react'
import MotorCityApp from './MotorCityApp'
import { IntroSplash } from './components/IntroSplash'
import { TeamLauncher } from './team/TeamLauncher'
import { TeamSession } from './team/TeamSession'
import { ApiClientError, teamApi } from './team/api'
import type { TeamCredentials, TeamSessionSnapshot } from './team/types'
import './Launcher.css'

const TEAM_SESSION_HINT_KEY = 'motor-city-team-session-v1'
/**
 * Set when a player deliberately leaves. Stored alongside the hint rather than in
 * sessionStorage: the session cookie survives a browser restart, so the thing that
 * suppresses it has to survive one too, or the next person inherits the session.
 */
const STAY_OUT_KEY = 'motor-city-left-session'
const INTRO_MINIMUM_MS = 1400
/** The boot probe must never be able to leave a player staring at the splash. */
const BOOT_WATCHDOG_MS = 9000

type Screen = 'booting' | 'launcher' | 'solo' | 'team'

export default function RootApp() {
  const [screen, setScreen] = useState<Screen>('booting')
  const [hasTeamSession, setHasTeamSession] = useState(() =>
    localStorage.getItem(TEAM_SESSION_HINT_KEY) === '1',
  )
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [resumed, setResumed] = useState(false)
  const [bootSnapshot, setBootSnapshot] = useState<TeamSessionSnapshot | null>(null)

  const openTeam = (credentials: TeamCredentials) => {
    localStorage.setItem(TEAM_SESSION_HINT_KEY, '1')
    localStorage.removeItem(STAY_OUT_KEY)
    setHasTeamSession(true)
    setRecoveryCode(credentials.recoveryCode)
    setResumed(false)
    setScreen('team')
  }

  const clearTeam = useCallback(() => {
    localStorage.removeItem(TEAM_SESSION_HINT_KEY)
    localStorage.removeItem(STAY_OUT_KEY)
    setHasTeamSession(false)
    setRecoveryCode(null)
    setBootSnapshot(null)
    setScreen('launcher')
  }, [])

  const leaveTeam = () => {
    localStorage.setItem(STAY_OUT_KEY, '1')
    setBootSnapshot(null)
    setScreen('launcher')
  }

  const resumeTeam = () => {
    localStorage.removeItem(STAY_OUT_KEY)
    setScreen('team')
  }

  const forgetTeam = async () => {
    try {
      await teamApi.revokeSession()
      clearTeam()
    } catch {
      // The cookie may still be live server-side, so stay out until a revoke succeeds.
      localStorage.setItem(STAY_OUT_KEY, '1')
      setBootSnapshot(null)
      setScreen('launcher')
    }
  }

  // The signed session cookie is the source of truth, so ask the server before showing a form.
  useEffect(() => {
    let active = true
    let settled = false
    const settleAt = Date.now() + INTRO_MINIMUM_MS

    const settle = (next: Screen, wasResumed = false) => {
      if (settled) return
      settled = true
      window.clearTimeout(watchdog)
      window.setTimeout(() => {
        if (!active) return
        setResumed(wasResumed)
        setScreen(next)
      }, Math.max(0, settleAt - Date.now()))
    }

    // A request that never resolves must not strand the player on the splash.
    const watchdog = window.setTimeout(() => settle('launcher'), BOOT_WATCHDOG_MS)

    teamApi.getSession().then(
      (snapshot) => {
        if (!active) return
        localStorage.setItem(TEAM_SESSION_HINT_KEY, '1')
        setHasTeamSession(true)
        setBootSnapshot(snapshot)
        settle(localStorage.getItem(STAY_OUT_KEY) === '1' ? 'launcher' : 'team', true)
      },
      (caught: unknown) => {
        if (!active) return
        // Only an explicit rejection means signed out; a flaky network must not wipe the hint.
        if (caught instanceof ApiClientError && caught.status === 401) {
          localStorage.removeItem(TEAM_SESSION_HINT_KEY)
          localStorage.removeItem(STAY_OUT_KEY)
          setHasTeamSession(false)
        }
        settle('launcher')
      },
    )

    return () => {
      active = false
      window.clearTimeout(watchdog)
    }
  }, [])

  if (screen === 'booting') {
    return <IntroSplash status="Checking your shift..." />
  }

  if (screen === 'solo') {
    return <MotorCityApp onExit={() => setScreen('launcher')} />
  }

  if (screen === 'team' && hasTeamSession) {
    return (
      <TeamSession
        recoveryCode={recoveryCode}
        resumed={resumed}
        initialSnapshot={bootSnapshot}
        onExit={leaveTeam}
        onInvalid={clearTeam}
      />
    )
  }

  return (
    <TeamLauncher
      savedTeamSession={hasTeamSession}
      onSolo={() => setScreen('solo')}
      onTeam={openTeam}
      onResume={resumeTeam}
      onForget={() => void forgetTeam()}
    />
  )
}