import type {
  ResourcePlan,
  RoundTimerConfig,
  RoundTimerSegment,
} from './types'

export const defaultEndRound = (resourcePlan: ResourcePlan) =>
  resourcePlan === 'evan' ? 25 : 10

export function recommendedEvanTimerConfig(): RoundTimerConfig {
  return {
    enabled: true,
    segments: [
      { startRound: 1, endRound: 10, durationSeconds: 600 },
      { startRound: 11, endRound: 25, durationSeconds: 300 },
    ],
  }
}

export function originalTimerConfig(
  endRound: number,
  enabled = false,
): RoundTimerConfig {
  const finalRound = Math.max(1, Math.floor(endRound))
  const segments: RoundTimerSegment[] = finalRound <= 8
    ? [{ startRound: 1, endRound: finalRound, durationSeconds: 600 }]
    : [
        { startRound: 1, endRound: 8, durationSeconds: 600 },
        { startRound: 9, endRound: finalRound, durationSeconds: 180 },
      ]
  return { enabled, segments }
}

export function roundTimerDurationSeconds(
  timer: RoundTimerConfig,
  round: number,
) {
  if (!timer.enabled) return null
  return timer.segments.find(
    (segment) => round >= segment.startRound && round <= segment.endRound,
  )?.durationSeconds ?? null
}

export function validateTimerCoverage(
  timer: RoundTimerConfig,
  endRound: number,
): string | null {
  if (!timer.enabled) return null
  if (timer.segments.length === 0) return 'Add at least one timer block.'
  let expectedStart = 1
  for (const segment of timer.segments) {
    if (segment.startRound !== expectedStart) {
      return `Timer blocks must continue at round ${expectedStart}.`
    }
    if (segment.endRound < segment.startRound) {
      return 'A timer block cannot end before it starts.'
    }
    expectedStart = segment.endRound + 1
  }
  if (expectedStart - 1 !== endRound) {
    return `Timer blocks must end at round ${endRound}.`
  }
  return null
}

export function describeRoundTimer(timer: RoundTimerConfig) {
  if (!timer.enabled) return 'Off'
  return timer.segments.map((segment) => {
    const duration = segment.durationSeconds % 60 === 0
      ? `${segment.durationSeconds / 60} min`
      : `${segment.durationSeconds} sec`
    return `R${segment.startRound}-${segment.endRound}: ${duration}`
  }).join('; ')
}