import { Worker } from 'node:worker_threads'

const config = {
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

const worker = new Worker(
  new URL('../dist-server/optimizer-worker.js', import.meta.url),
  {
    workerData: {
      input: { config, endRound: 6, penaltyRound: 6 },
      timeLimitSeconds: 5,
    },
  },
)

const timeout = setTimeout(() => {
  void worker.terminate()
}, 10_000)

try {
  const response = await new Promise((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Optimizer worker exited ${code}.`))
    })
  })
  if (
    !response?.ok
    || response.solution?.proof !== 'optimal'
    || response.solution?.player?.projectedScore !== 6
    || response.solution?.player?.history?.length !== 6
  ) {
    throw new Error('Built optimizer worker returned an unexpected result.')
  }
  console.log('Built optimizer worker passed its engine-replay check.')
} finally {
  clearTimeout(timeout)
  await worker.terminate()
}
