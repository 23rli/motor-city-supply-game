export function formatElapsedTime(
  startedAt: string | null,
  endedAt: string | null,
  currentTime = Date.now(),
) {
  if (!startedAt) return '00:00:00'
  const started = Date.parse(startedAt)
  const stopped = endedAt ? Date.parse(endedAt) : currentTime
  const elapsedSeconds = Math.max(0, Math.floor((stopped - started) / 1_000))
  const hours = Math.floor(elapsedSeconds / 3_600)
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60)
  const seconds = elapsedSeconds % 60
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}