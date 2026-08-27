import { Worker } from 'node:worker_threads'

const MAX_CAPACITY_RSS_BYTES = 768 * 1_024 * 1_024

const baseConfig = {
  enabledModels: ['green'],
  resourcePlan: 'classic',
  resourceSchedule: Array.from(
    { length: 6 },
    () => ({ red: 10, yellow: 8, blue: 4 }),
  ),
  revenue: { blue: 3, green: 2, red: 2.5, yellow: 2.5 },
  wipPenalty: { blue: 1.5, green: 1, red: 1.25, yellow: 1.25 },
  notes: '',
  timer: { enabled: false, segments: [] },
}

const runWorker = async (input, timeLimitSeconds, timeoutMs) => {
  const worker = new Worker(
    new URL('../dist-server/optimizer-worker.js', import.meta.url),
    { workerData: { input, timeLimitSeconds } },
  )
  let peakRssBytes = process.memoryUsage.rss()
  const sampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss())
  }, 25)
  sampler.unref()
  const timeout = setTimeout(() => {
    void worker.terminate()
  }, timeoutMs)

  try {
    const response = await new Promise((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`Optimizer worker exited ${code}.`))
      })
    })
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage.rss())
    return { response, peakRssBytes }
  } finally {
    clearTimeout(timeout)
    clearInterval(sampler)
    await worker.terminate()
  }
}

const exact = await runWorker(
  { config: baseConfig, endRound: 6, penaltyRound: 6 },
  5,
  10_000,
)
if (
  !exact.response?.ok
  || exact.response.solution?.proof !== 'optimal'
  || exact.response.solution?.player?.projectedScore !== 6
  || exact.response.solution?.player?.history?.length !== 6
) {
  throw new Error('Built optimizer worker returned an unexpected exact result.')
}

const capacityConfig = {
  ...baseConfig,
  enabledModels: ['blue', 'green', 'red', 'yellow'],
  resourcePlan: 'random',
  resourceSchedule: Array.from(
    { length: 100 },
    () => ({ red: 10, yellow: 8, blue: 4 }),
  ),
}
const capacity = await runWorker(
  { config: capacityConfig, endRound: 100, penaltyRound: 100 },
  1,
  30_000,
)
const capacityPlayer = capacity.response?.solution?.player
if (
  !capacity.response?.ok
  || !capacityPlayer
  || capacityPlayer.history?.length !== 100
  || capacityPlayer.throughput <= 0
  || !Number.isFinite(capacityPlayer.projectedScore)
) {
  throw new Error('Built optimizer worker failed its maximum-horizon engine replay.')
}
if (capacity.peakRssBytes > MAX_CAPACITY_RSS_BYTES) {
  throw new Error(
    `Built optimizer exceeded its capacity RSS limit: ${Math.ceil(capacity.peakRssBytes / 1_024 / 1_024)} MiB.`,
  )
}

console.log(
  `Built optimizer passed exact and maximum-horizon checks (peak RSS ${Math.ceil(capacity.peakRssBytes / 1_024 / 1_024)} MiB).`,
)
