import type { PlayerCommand, PlayerCommandResponse } from './types'

export function commandPreemptedByTimeout(
  command: PlayerCommand,
  result: PlayerCommandResponse,
) {
  return command.type !== 'timeout' && result.roundTimedOut
}

export function remainingRoundSeconds(
  roundStartedAt: string | null,
  durationSeconds: number | null,
  currentTime: number,
  timedOut: boolean,
) {
  if (!roundStartedAt || durationSeconds === null) return null
  if (timedOut) return 0
  const elapsed = Math.floor((currentTime - Date.parse(roundStartedAt)) / 1_000)
  return Math.max(0, durationSeconds - elapsed)
}

export function formatRoundCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function roundTimerAnnouncement(
  previousSeconds: number | null,
  seconds: number,
) {
  if ((previousSeconds === null && seconds === 60) || (
    previousSeconds !== null && previousSeconds > 60 && seconds <= 60
  )) {
    return { threshold: 60, message: 'One minute remaining.' }
  }
  if ((previousSeconds === null && seconds === 10) || (
    previousSeconds !== null && previousSeconds > 10 && seconds <= 10
  )) {
    return { threshold: 10, message: 'Ten seconds remaining.' }
  }
  return null
}