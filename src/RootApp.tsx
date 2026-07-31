import { useState } from 'react'
import MotorCityApp from './MotorCityApp'
import { TeamLauncher } from './team/TeamLauncher'
import { TeamSession } from './team/TeamSession'
import { teamApi } from './team/api'
import type { TeamCredentials } from './team/types'
import './Launcher.css'

const TEAM_SESSION_HINT_KEY = 'motor-city-team-session-v1'

type Screen = 'launcher' | 'solo' | 'team'

export default function RootApp() {
  const [screen, setScreen] = useState<Screen>('launcher')
  const [hasTeamSession, setHasTeamSession] = useState(() =>
    localStorage.getItem(TEAM_SESSION_HINT_KEY) === '1',
  )
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)

  const openTeam = (credentials: TeamCredentials) => {
    localStorage.setItem(TEAM_SESSION_HINT_KEY, '1')
    setHasTeamSession(true)
    setRecoveryCode(credentials.recoveryCode)
    setScreen('team')
  }

  const clearTeam = () => {
    localStorage.removeItem(TEAM_SESSION_HINT_KEY)
    setHasTeamSession(false)
    setRecoveryCode(null)
    setScreen('launcher')
  }

  const forgetTeam = async () => {
    try {
      await teamApi.revokeSession()
    } catch {
      // The local hint still needs clearing when the session already expired.
    } finally {
      clearTeam()
    }
  }

  if (screen === 'solo') {
    return <MotorCityApp onExit={() => setScreen('launcher')} />
  }

  if (screen === 'team' && hasTeamSession) {
    return (
      <TeamSession
        recoveryCode={recoveryCode}
        onExit={() => setScreen('launcher')}
        onInvalid={clearTeam}
      />
    )
  }

  return (
    <TeamLauncher
      savedTeamSession={hasTeamSession}
      onSolo={() => setScreen('solo')}
      onTeam={openTeam}
      onResume={() => setScreen('team')}
      onForget={() => void forgetTeam()}
    />
  )
}